"""Générateur de feuilles synthétiques (au format JSON de l'app) pour tester le regroupement.

Un mini « alphabet de traits » + un moteur de mise en page (texte, exposants, indices, fractions,
sommes/intégrales avec bornes). Ce n'est PAS de l'écriture réaliste : ça sert à vérifier que les
fractions, exposants et bornes restent bien groupés, pas à juger les modèles de reconnaissance.

    python samples/synth.py            # écrit samples/exemple.json et samples/exemple_verite.json
"""
from __future__ import annotations

import json
import math
import random
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

Pts = list[tuple[float, float]]


def arc(cx, cy, rx, ry, a0, a1, n=14) -> Pts:
    """Arc d'ellipse, angles en degrés (sens trigonométrique, y vers le haut → y écran inversé)."""
    return [(cx + rx * math.cos(math.radians(a0 + (a1 - a0) * k / n)), cy - ry * math.sin(math.radians(a0 + (a1 - a0) * k / n))) for k in range(n + 1)]


# Glyphes dans une boîte de largeur ~0.6 et hauteur 1 ; y vers le BAS, la ligne de base est y = 1.
GLYPHES: dict[str, list[Pts]] = {
    "0": [arc(0.3, 0.5, 0.28, 0.5, 90, 450, 18)],
    "1": [[(0.12, 0.25), (0.35, 0.0), (0.35, 1.0)]],
    "2": [arc(0.3, 0.27, 0.26, 0.26, 160, -30, 12) + [(0.04, 1.0), (0.56, 1.0)]],
    "3": [arc(0.3, 0.26, 0.25, 0.24, 150, -100, 10) + arc(0.3, 0.74, 0.28, 0.26, 100, -150, 10)],
    "4": [[(0.45, 1.0), (0.45, 0.0), (0.02, 0.68), (0.6, 0.68)]],
    "5": [[(0.52, 0.0), (0.12, 0.0), (0.08, 0.45)] + arc(0.3, 0.68, 0.28, 0.3, 115, -150, 12)],
    "6": [[(0.5, 0.0), (0.15, 0.45), (0.04, 0.68)], arc(0.3, 0.7, 0.27, 0.3, 0, 360, 16)],
    "7": [[(0.05, 0.0), (0.58, 0.0), (0.22, 1.0)]],
    "8": [arc(0.3, 0.27, 0.22, 0.25, 0, 360, 14), arc(0.3, 0.75, 0.27, 0.25, 0, 360, 14)],
    "9": [arc(0.3, 0.3, 0.27, 0.3, 0, 360, 16), [(0.57, 0.32), (0.45, 0.55), (0.1, 1.0)]],
    "x": [[(0.05, 0.4), (0.55, 1.0)], [(0.55, 0.4), (0.05, 1.0)]],
    "y": [[(0.05, 0.4), (0.3, 0.85)], [(0.55, 0.4), (0.2, 1.3)]],
    "d": [arc(0.3, 0.7, 0.27, 0.3, 0, 360, 14), [(0.57, 0.0), (0.57, 1.0)]],
    "+": [[(0.05, 0.65), (0.55, 0.65)], [(0.3, 0.4), (0.3, 0.9)]],
    "-": [[(0.05, 0.65), (0.55, 0.65)]],
    "=": [[(0.05, 0.5), (0.55, 0.5)], [(0.05, 0.8), (0.55, 0.8)]],
    "(": [arc(0.75, 0.5, 0.55, 0.55, 125, 235, 8)],
    ")": [arc(-0.15, 0.5, 0.55, 0.55, 55, -55, 8)],
}
LARGEUR_GLYPHE = 0.6
SYMBOLES_GRANDS = {
    "∑": [[(0.55, 0.0), (0.05, 0.0), (0.35, 0.5), (0.05, 1.0), (0.6, 1.0)]],
    "∫": [[(0.55, 0.08), (0.45, 0.0), (0.33, 0.08), (0.3, 0.5), (0.27, 0.92), (0.15, 1.0), (0.05, 0.92)]],
}


@dataclass
class Boite:
    """Strokes en coordonnées locales : x vers la droite, y vers le bas, ligne de base en y = 0."""

    traits: list[Pts] = field(default_factory=list)
    w: float = 0.0

    def decale(self, dx: float, dy: float) -> "Boite":
        return Boite([[(x + dx, y + dy) for x, y in t] for t in self.traits], self.w)


def glyphe(c: str, taille: float) -> Boite:
    return Boite([[(x * taille, (y - 1.0) * taille) for x, y in t] for t in GLYPHES[c]], LARGEUR_GLYPHE * taille)


def texte(s: str, taille: float, espace: float = 0.2) -> Boite:
    out, x = Boite(), 0.0
    for c in s:
        g = glyphe(c, taille).decale(x, 0)
        out.traits += g.traits
        x += g.w + espace * taille
    out.w = x - espace * taille
    return out


def hcat(*boites: Boite, ecart: float = 0.0) -> Boite:
    out, x = Boite(), 0.0
    for b in boites:
        out.traits += b.decale(x, 0).traits
        x += b.w + ecart
    out.w = x - ecart
    return out


def exposant(base: Boite, e: Boite, taille: float) -> Boite:
    return hcat(base, e.decale(0, -0.55 * taille), ecart=0.04 * taille)


def indice(base: Boite, i: Boite, taille: float) -> Boite:
    return hcat(base, i.decale(0, 0.25 * taille), ecart=0.04 * taille)


def fraction(num: Boite, den: Boite, taille: float) -> Boite:
    axe, vide = -0.3 * taille, 0.22 * taille
    large = max(num.w, den.w) + 0.4 * taille
    n = num.decale((large - num.w) / 2, axe - vide)
    d = den.decale((large - den.w) / 2, axe + vide + 0.8 * taille)
    barre = [(0.0, axe), (large, axe)]
    return Boite(n.traits + [barre] + d.traits, large)


def grand_symbole(sym: str, haut: Boite | None, bas: Boite | None, taille: float, lateral: bool = False) -> Boite:
    hs = 1.7 * taille  # hauteur du symbole
    ws = 0.65 * taille if sym == "∑" else 0.4 * taille
    trs = [[(x * ws / 0.6 if sym == "∑" else x * ws / 0.6, (y - 1.0) * hs + 0.35 * taille) for x, y in t] for t in SYMBOLES_GRANDS[sym]]
    top, bottom = 0.35 * taille - hs, 0.35 * taille
    out = Boite(trs, ws)
    if lateral:  # bornes à droite (intégrale)
        x = ws + 0.1 * taille
        w = 0.0
        if haut:
            b = haut.decale(x + 0.25 * taille, top + 0.25 * taille)
            out.traits += b.traits
            w = max(w, haut.w + 0.25 * taille)
        if bas:
            b = bas.decale(x, bottom + 0.05 * taille)
            out.traits += b.traits
            w = max(w, bas.w)
        out.w = x + w
    else:  # bornes centrées au-dessus / au-dessous (somme)
        if haut:
            out.traits += haut.decale((ws - haut.w) / 2, top - 0.2 * taille).traits
        if bas:
            out.traits += bas.decale((ws - bas.w) / 2, bottom + 0.2 * taille + 0.65 * taille).traits
        out.w = max(ws, haut.w if haut else 0, bas.w if bas else 0)
    return out


def haut_bas(b: Boite) -> tuple[float, float]:
    ys = [y for t in b.traits for _, y in t]
    return min(ys), max(ys)


# ----- Exemples ------------------------------------------------------------------------------------
def exemple(taille: float = 40.0) -> list[tuple[Boite, str]]:
    """(mise en page, LaTeX attendu) pour chaque ligne."""
    t = taille
    petit = 0.65 * t
    return [
        (texte("12+3x=7", t), "12+3x=7"),
        (
            hcat(fraction(texte("x+1", 0.8 * t), texte("2", 0.8 * t), t), texte("=3", t), ecart=0.25 * t),
            r"\frac{x+1}{2}=3",
        ),
        (
            hcat(
                exposant(texte("x", t), texte("2", petit), t),
                texte("+", t),
                exposant(texte("y", t), texte("2", petit), t),
                texte("=1", t),
                ecart=0.22 * t,
            ),
            "x^2+y^2=1",
        ),
        (
            hcat(grand_symbole("∑", texte("10", petit), texte("x=1", petit), t), texte("x", t), ecart=0.25 * t),
            r"\sum_{x=1}^{10}x",
        ),
        (
            hcat(grand_symbole("∫", texte("1", petit), texte("0", petit), t, lateral=True), texte("x", t), texte("dx", t), ecart=0.25 * t),
            r"\int_0^1xdx",
        ),
        (
            hcat(
                fraction(texte("1", 0.8 * t), hcat(texte("2", 0.8 * t), texte("+", 0.8 * t), fraction(texte("1", 0.6 * t), texte("x", 0.6 * t), 0.8 * t), ecart=0.15 * t), t),
                texte("-", t),
                texte("3", t),
                ecart=0.25 * t,
            ),
            r"\frac{1}{2+\frac{1}{x}}-3",
        ),
    ]


def vers_feuille(lignes: list[Boite], taille: float, graine: int = 1, x0: float = 60.0, y0: float = 80.0):
    """Place les lignes les unes sous les autres ; renvoie (JSON de l'app, étiquette de ligne par trait)."""
    rng = random.Random(graine)
    traits, etiquettes, t_ms, y = [], [], 1_700_000_000_000, y0
    for k, b in enumerate(lignes):
        top, bottom = haut_bas(b)
        y -= top  # le haut de la ligne se place sous la précédente
        for pts in b.traits:
            a = np.array([(x + x0, yy + y) for x, yy in pts])
            # sur-échantillonne puis ajoute un léger tremblement
            dense = []
            for p, q in zip(a[:-1], a[1:]):
                n = max(1, int(np.hypot(*(q - p)) / 2.5))
                dense += [p + (q - p) * i / n for i in range(n)]
            dense.append(a[-1])
            dense = np.array(dense) + np.array([[rng.gauss(0, 0.35), rng.gauss(0, 0.35)] for _ in dense])
            debut = t_ms
            pts_json = []
            for p in dense:
                t_ms += 8
                pts_json.append([round(float(p[0]), 2), round(float(p[1]), 2), round(rng.uniform(0.4, 0.7), 3), t_ms])
            traits.append(
                {"id": f"s{len(traits)}", "couleur": "#111111", "epaisseur": 2, "outil": "stylo", "debut": debut, "fin": t_ms, "points": pts_json}
            )
            etiquettes.append(k)
            t_ms += rng.randint(250, 600)  # pause entre deux traits
        y += bottom + 0.9 * taille
        t_ms += rng.randint(1500, 3000)  # pause entre deux lignes
    return {"version": 1, "largeur": 800, "fond": "blanc", "traits": traits}, etiquettes


if __name__ == "__main__":
    dossier = Path(__file__).resolve().parent
    taille = 40.0
    ex = exemple(taille)
    feuille, _ = vers_feuille([b for b, _ in ex], taille)
    (dossier / "exemple.json").write_text(json.dumps(feuille), encoding="utf-8")
    (dossier / "exemple_verite.json").write_text(
        json.dumps({f"G{k + 1}": latex for k, (_, latex) in enumerate(ex)}, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"écrit {len(feuille['traits'])} traits, {len(ex)} lignes", file=sys.stderr)
