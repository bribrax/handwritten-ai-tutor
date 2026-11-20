"""Regroupement des traits en groupes à reconnaître (une ligne d'écriture, fractions comprises).

Principe : on commence par souder les *structures* (morceaux d'un caractère, fractions, grands
symboles avec leurs bornes), puis on relie les structures entre elles pour former des lignes.
Toutes les distances sont des multiples de h (hauteur typique d'un caractère).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .feuille import Trait


class _UF:
    def __init__(self, n: int):
        self.p = list(range(n))

    def find(self, a: int) -> int:
        while self.p[a] != a:
            self.p[a] = self.p[self.p[a]]
            a = self.p[a]
        return a

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[max(ra, rb)] = min(ra, rb)

    def composantes(self) -> list[list[int]]:
        comps: dict[int, list[int]] = {}
        for i in range(len(self.p)):
            comps.setdefault(self.find(i), []).append(i)
        return list(comps.values())


@dataclass
class Groupe:
    id: str
    indices: list[int]  # indices dans la liste de traits
    x0: float
    y0: float
    x1: float
    y1: float
    bruit: bool = False
    avertissements: list[str] = field(default_factory=list)
    structures: list[str] = field(default_factory=list)  # ex. « fraction », « grand symbole »

    @property
    def w(self) -> float:
        return self.x1 - self.x0

    @property
    def h(self) -> float:
        return self.y1 - self.y0


def regrouper(traits: list[Trait], cfg, h: float) -> list[Groupe]:
    """`cfg` = Config.groupement ; `h` = hauteur typique d'un caractère (unités feuille)."""
    n = len(traits)
    X0 = np.array([t.x0 for t in traits])
    Y0 = np.array([t.y0 for t in traits])
    X1 = np.array([t.x1 for t in traits])
    Y1 = np.array([t.y1 for t in traits])
    T0 = np.array([t.debut for t in traits])
    T1 = np.array([t.fin for t in traits])
    W, H = X1 - X0, Y1 - Y0
    CX, CY = (X0 + X1) / 2, (Y0 + Y1) / 2
    eps = 0.05 * h

    uf = _UF(n)
    annexe = np.zeros(n, bool)  # numérateur / dénominateur / bornes : hors « ligne principale »
    barre_frac = np.zeros(n, bool)
    structures: dict[int, set[str]] = {}  # racine finale -> étiquettes (calculé à la fin)
    etiquette: list[tuple[int, str]] = []

    def inter_len(a0, a1, b0, b1):
        return np.maximum(0.0, np.minimum(a1, b1) - np.maximum(a0, b0))

    def gap(a0, a1, b0, b1):
        return np.maximum(0.0, np.maximum(a0, b0) - np.minimum(a1, b1))

    # --- A. Morceaux d'un même caractère / caractères collés -------------------------------
    dx = gap(X0[:, None], X1[:, None], X0[None, :], X1[None, :])
    dy = gap(Y0[:, None], Y1[:, None], Y0[None, :], Y1[None, :])
    for i, j in np.argwhere(np.triu((dx <= cfg.proche_dx * h) & (dy <= cfg.proche_dy * h), 1)):
        uf.union(int(i), int(j))

    # --- B. Inclusion (racine, grandes parenthèses, caractère entouré) ---------------------
    Wc, Hc = np.maximum(W, eps), np.maximum(H, eps)
    aire = Wc * Hc
    inter = inter_len(X0[:, None], X1[:, None], X0[None, :], X1[None, :]) * inter_len(
        Y0[:, None], Y1[:, None], Y0[None, :], Y1[None, :]
    )
    # ratio[i, j] = part du trait j contenue dans le trait i
    ratio = inter / aire[None, :]
    gros = aire[:, None] >= 2 * aire[None, :]
    for i, j in np.argwhere((ratio >= cfg.inclusion) & gros):
        if i != j:
            uf.union(int(i), int(j))

    caracteres = uf.composantes()  # caractères soudés (avant fractions) : un ∑ fait de plusieurs traits est un seul grand symbole

    # --- C. Fractions -----------------------------------------------------------------------
    est_barre = (W / Hc >= cfg.barre_ratio_min) & (W >= cfg.barre_longueur_min * h) & (H <= cfg.barre_epaisseur_max * h)
    marge = cfg.fraction_marge_x * h
    dmax = cfg.fraction_distance_max * h
    for b in np.flatnonzero(est_barre):
        centre_ok = (CX >= X0[b] - marge) & (CX <= X1[b] + marge) & (W <= cfg.fraction_largeur_max * max(W[b], eps))
        centre_ok[b] = False
        # Deux barres de largeur voisine très proches = signe « = » : jamais numérateur/dénominateur.
        egal = est_barre & (W >= 0.6 * W[b])
        haut = centre_ok & (CY < Y0[b]) & (Y0[b] - Y1 <= dmax) & (Y0[b] - Y1 >= -0.3 * h)
        bas = centre_ok & (CY > Y1[b]) & (Y0 - Y1[b] <= dmax) & (Y0 - Y1[b] >= -0.3 * h)
        haut &= ~(egal & (Y0[b] - Y1 <= 0.8 * h))
        bas &= ~(egal & (Y0 - Y1[b] <= 0.8 * h))
        if haut.any() and bas.any():
            barre_frac[b] = True
            for s in np.flatnonzero(haut | bas):
                uf.union(int(b), int(s))
            annexe |= haut | bas
            etiquette.append((int(b), "fraction"))

    # --- D. Grands symboles (∑ ∏ ∫ …) et leurs bornes --------------------------------------
    grands: set[int] = set()  # un trait par grand symbole, même sans borne absorbée
    for comp in caracteres:
        if len(comp) == 1 and est_barre[comp[0]]:
            continue
        cm = np.array(comp)
        sx0, sx1, sy0, sy1 = X0[cm].min(), X1[cm].max(), Y0[cm].min(), Y1[cm].max()
        if sy1 - sy0 < cfg.grand_symbole_hauteur * h:
            continue
        # Plusieurs traits soudés : seulement un petit symbole (∑ en 3 traits), pas une racine pleine de contenu.
        if len(comp) > 1 and (len(comp) > 4 or sx1 - sx0 > 2.5 * h):
            continue
        t = comp[0]
        grands.add(t)
        scx = (sx0 + sx1) / 2
        dans_x = (CX >= sx0 - cfg.absorption_marge_x * h) & (CX <= sx1 + cfg.grand_symbole_dx * h)
        dans_y = (CY >= sy0 - cfg.grand_symbole_dy * h) & (CY <= sy1 + cfg.grand_symbole_dy * h)
        petit = H <= cfg.petit_trait_hauteur * h
        # Au-dessus / au-dessous : seulement dans l'aplomb du symbole (bornes d'une somme).
        hors_bande = (CY < sy0) | (CY > sy1)
        aplomb = (CX >= sx0 - cfg.absorption_marge_x * h) & (CX <= sx1 + cfg.absorption_marge_x * h)
        cand = dans_x & dans_y & petit & (~hors_bande | aplomb | (X0 >= scx))
        cand[cm] = False
        ecart_t = np.maximum(0.0, np.maximum(T0, T0[cm].min()) - np.minimum(T1, T1[cm].max()))
        dist = np.hypot(gap(X0, X1, sx0, sx1), gap(Y0, Y1, sy0, sy1))
        # Une borne écrite tard (ex. n au-dessus d'un ∑ après k=1) reste liée si elle est collée au symbole.
        cand &= (ecart_t <= cfg.temps_proche_s) | (dist <= cfg.borne_dist_sans_temps * h)
        cand &= ~barre_frac  # une barre de fraction n'est jamais une borne : elle porte la bande de ligne
        if cand.any():
            for s in np.flatnonzero(cand):
                uf.union(int(t), int(s))
            annexe |= cand & hors_bande
            etiquette.append((int(t), "grand symbole"))

    # --- E. Structures → lignes -------------------------------------------------------------
    for _ in range(cfg.passes):
        comps = uf.composantes()
        k = len(comps)
        if k < 2:
            break
        bx0, bx1 = np.empty(k), np.empty(k)
        by0, by1 = np.empty(k), np.empty(k)  # bande « ligne principale »
        t0, t1 = np.empty(k), np.empty(k)
        for c, m in enumerate(comps):
            m = np.array(m)
            bx0[c], bx1[c] = X0[m].min(), X1[m].max()
            t0[c], t1[c] = T0[m].min(), T1[m].max()
            corps = m[~annexe[m]] if (~annexe[m]).any() else m
            lo, hi = Y0[corps].copy(), Y1[corps].copy()
            for q, s in enumerate(corps):
                if barre_frac[s]:  # une fraction occupe la bande de sa barre, pas toute sa hauteur
                    lo[q], hi[q] = CY[s] - cfg.fraction_demi_bande * h, CY[s] + cfg.fraction_demi_bande * h
            by0[c], by1[c] = lo.min(), hi.max()
        bh = np.maximum(by1 - by0, eps)
        bc = (by0 + by1) / 2

        gx = gap(bx0[:, None], bx1[:, None], bx0[None, :], bx1[None, :])
        gt = np.maximum(0.0, np.maximum(t0[:, None], t0[None, :]) - np.minimum(t1[:, None], t1[None, :]))
        inter_v = inter_len(by0[:, None], by1[:, None], by0[None, :], by1[None, :])
        rec = inter_v / np.minimum(bh[:, None], bh[None, :])
        # Petit trait (« - », « . ») dont le centre tombe dans la bande de l'autre.
        petit_i = bh[:, None] <= bh[None, :]
        tol = cfg.ligne_tolerance * h
        dedans = np.where(
            petit_i,
            (bc[:, None] >= by0[None, :] - tol) & (bc[:, None] <= by1[None, :] + tol),
            (bc[None, :] >= by0[:, None] - tol) & (bc[None, :] <= by1[:, None] + tol),
        )
        # Un grand symbole (lim, ∑, ∫…) tolère un écart plus large avec ce qui le suit.
        racines_gs = {uf.find(i) for i in grands}
        gs_c = np.array([uf.find(m[0]) in racines_gs for m in comps])
        ecart_max = np.where(gs_c[:, None] | gs_c[None, :], cfg.ligne_ecart_grand_h, cfg.ligne_ecart_h) * h
        forte = ((rec >= cfg.ligne_recouvrement) | dedans) & (gx <= ecart_max)

        m_v = cfg.exposant_marge_v * h
        inter_exp = inter_len(by0[:, None] - m_v, by1[:, None] + m_v, by0[None, :] - m_v, by1[None, :] + m_v)
        faible = (
            (inter_exp > 0)
            & (np.abs(bc[:, None] - bc[None, :]) <= cfg.exposant_decalage * h)
            & (gx <= cfg.exposant_ecart_h * h)
            & (gt <= cfg.temps_proche_s)
        )
        lien = np.triu(forte | faible, 1)
        paires = np.argwhere(lien)
        if len(paires) == 0:
            break
        for a, b in paires:
            uf.union(comps[a][0], comps[b][0])

    # --- Groupes finaux -----------------------------------------------------------------------
    racine_etiq: dict[int, set[str]] = {}
    for idx, nom in etiquette:
        racine_etiq.setdefault(uf.find(idx), set()).add(nom)

    groupes: list[tuple[float, Groupe]] = []
    for m in uf.composantes():
        m_arr = np.array(m)
        g = Groupe(
            id="",
            indices=sorted(int(i) for i in m),
            x0=float(X0[m_arr].min()),
            y0=float(Y0[m_arr].min()),
            x1=float(X1[m_arr].max()),
            y1=float(Y1[m_arr].max()),
            structures=sorted(racine_etiq.get(uf.find(m[0]), [])),
        )
        corps = m_arr[~annexe[m_arr]] if (~annexe[m_arr]).any() else m_arr
        centre = float((Y0[corps].min() + Y1[corps].max()) / 2)
        if g.w < cfg.bruit_taille * h and g.h < cfg.bruit_taille * h:
            g.bruit = True
            g.avertissements.append("trop petit : ignoré (bruit)")
        if len(m) == 1 and g.w >= cfg.separateur_largeur * h and g.w / max(g.h, eps) >= cfg.separateur_ratio:
            g.bruit = True  # garde son numéro G pour ne pas décaler les vérités
            g.avertissements.append("règle de séparation : ignorée")
        if g.h > cfg.hauteur_suspecte * h:
            g.avertissements.append(f"très haut ({g.h / h:.1f} h) : plusieurs lignes fusionnées ?")
        groupes.append((centre, g))

    # Ordre de lecture : de haut en bas, puis de gauche à droite sur une même rangée.
    groupes.sort(key=lambda cg: cg[0])
    rangees: list[list[tuple[float, Groupe]]] = []
    for cg in groupes:
        if rangees and cg[0] - rangees[-1][0][0] <= 0.8 * h:
            rangees[-1].append(cg)
        else:
            rangees.append([cg])
    out: list[Groupe] = []
    for r in rangees:
        out.extend(g for _, g in sorted(r, key=lambda cg: cg[1].x0))
    for k, g in enumerate(out, 1):
        g.id = f"G{k}"
    return out
