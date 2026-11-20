"""Rendu d'un groupe de traits en image noir sur blanc, à hauteur normalisée."""
from __future__ import annotations

import math

from PIL import Image, ImageDraw

from .feuille import Trait
from .groupement import Groupe


def rendre_groupe(traits: list[Trait], groupe: Groupe, h: float, cfg, hauteur_px: int) -> Image.Image:
    """Image RGB dont la hauteur vaut exactement `hauteur_px`.

    `h` = hauteur typique d'un caractère (unités feuille) ; marge et épaisseur en sont des multiples,
    de sorte que le trait garde la même allure quelle que soit la taille de l'écriture.
    """
    marge = cfg.marge * h
    echelle = hauteur_px / (groupe.h + 2 * marge)  # px par unité feuille
    larg = max(1, math.ceil((groupe.w + 2 * marge) * echelle))
    ss = int(cfg.surechantillonnage)
    epaisseur = max(2.0, cfg.epaisseur * h * echelle) * ss

    img = Image.new("L", (larg * ss, hauteur_px * ss), 255)
    d = ImageDraw.Draw(img)
    r = epaisseur / 2
    for i in groupe.indices:
        pts = [((x - groupe.x0 + marge) * echelle * ss, (y - groupe.y0 + marge) * echelle * ss) for x, y in traits[i].pts]
        if len(pts) > 1:
            d.line(pts, fill=0, width=round(epaisseur), joint="curve")
        for x, y in (pts[0], pts[-1]):  # bouts ronds
            d.ellipse([x - r, y - r, x + r, y + r], fill=0)
    return img.resize((larg, hauteur_px), Image.LANCZOS).convert("RGB")


def apercu_page(traits: list[Trait], groupes: list[Groupe], h: float, largeur_px: int = 1100) -> Image.Image:
    """Vue d'ensemble de la feuille avec les groupes encadrés et numérotés (pour vérifier le regroupement)."""
    couleurs = [(220, 38, 38), (37, 99, 235), (22, 163, 74), (217, 119, 6), (147, 51, 234), (8, 145, 178)]
    x0 = min(t.x0 for t in traits) - h
    y0 = min(t.y0 for t in traits) - h
    x1 = max(t.x1 for t in traits) + h
    y1 = max(t.y1 for t in traits) + h
    echelle = largeur_px / (x1 - x0)
    img = Image.new("RGB", (largeur_px, max(1, math.ceil((y1 - y0) * echelle))), "white")
    d = ImageDraw.Draw(img)
    for k, g in enumerate(groupes):
        c = couleurs[k % len(couleurs)] if not g.bruit else (150, 150, 150)
        for i in g.indices:
            pts = [((x - x0) * echelle, (y - y0) * echelle) for x, y in traits[i].pts]
            if len(pts) > 1:
                d.line(pts, fill=c, width=2, joint="curve")
            else:
                d.ellipse([pts[0][0] - 2, pts[0][1] - 2, pts[0][0] + 2, pts[0][1] + 2], fill=c)
        bx = [(g.x0 - h * 0.3 - x0) * echelle, (g.y0 - h * 0.3 - y0) * echelle, (g.x1 + h * 0.3 - x0) * echelle, (g.y1 + h * 0.3 - y0) * echelle]
        d.rectangle(bx, outline=c, width=1)
        d.text((bx[0] + 2, bx[1] - 12), g.id, fill=c)
    return img
