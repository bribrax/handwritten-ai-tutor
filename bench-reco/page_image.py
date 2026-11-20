"""Image de la feuille pour Claude : traits noirs + un cadre numéroté autour de chaque groupe (mêmes ids que le rapport).

La page est réduite à ~1568 px de grand côté (limite à partir de laquelle un modèle de vision réduit lui-même l'image).
Option bandes : la page est découpée en bandes horizontales sans jamais couper un groupe.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

COTE_MAX = 1568  # px, grand côté
ECHELLE_MAX = 4.0  # px par unité feuille
CADRE = (214, 36, 159)  # magenta : ne se confond ni avec l'encre noire ni avec le bleu de l'élève ni avec les couleurs d'annotation


def _police(taille: int) -> ImageFont.ImageFont:
    for nom in ("arial.ttf", "DejaVuSans.ttf", "Arial.ttf"):
        try:
            return ImageFont.truetype(nom, taille)
        except OSError:
            continue
    return ImageFont.load_default()


def nb_bandes(groupes, h: float, bande_hauteur_h: float = 24.0, bandes_max: int = 8) -> int:
    """Nombre de bandes horizontales pour la feuille : une bande vise ~`bande_hauteur_h` × h de haut (1 si la feuille est courte)."""
    if not groupes:
        return 1
    hauteur = max(g.y1 for g in groupes) - min(g.y0 for g in groupes)
    return int(max(1, min(bandes_max, round(hauteur / (bande_hauteur_h * h)))))


def coupures(groupes, n: int) -> list[float]:
    """n-1 ordonnées de coupe, chacune dans un interstice vertical entre groupes, au plus près des tiers (ou moitiés…) de la page."""
    if n <= 1 or not groupes:
        return []
    intervalles = sorted((g.y0, g.y1) for g in groupes)
    fusion: list[list[float]] = []
    for a, b in intervalles:
        if fusion and a <= fusion[-1][1]:
            fusion[-1][1] = max(fusion[-1][1], b)
        else:
            fusion.append([a, b])
    milieux = [(fusion[i][1] + fusion[i + 1][0]) / 2 for i in range(len(fusion) - 1)]
    haut, bas = fusion[0][0], fusion[-1][1]
    coupes: list[float] = []
    for k in range(1, n):
        ideal = haut + (bas - haut) * k / n
        libres = [m for m in milieux if m not in coupes]
        if not libres:
            break
        coupes.append(min(libres, key=lambda m: abs(m - ideal)))
    return sorted(coupes)


def rendre_zone(traits, groupes, h: float, zone: tuple[float, float, float, float], chemin: Path, cadres: bool = True,
                seulement: set[str] | None = None) -> tuple[int, int]:
    """Dessine la zone (x0, y0, x1, y1) de la feuille et, si `cadres`, les cadres des groupes qui la touchent ; renvoie la taille de l'image.
    `seulement` : identifiants des seuls traits à dessiner (gros plan d'une sélection)."""
    x0, y0, x1, y1 = zone
    echelle = min(ECHELLE_MAX, COTE_MAX / max(x1 - x0, y1 - y0))
    img = Image.new("RGB", (max(1, round((x1 - x0) * echelle)), max(1, round((y1 - y0) * echelle))), "white")
    d = ImageDraw.Draw(img)
    trait_px = max(2, round(0.11 * h * echelle))
    for t in traits:
        if t.x1 < x0 or t.x0 > x1 or t.y1 < y0 or t.y0 > y1 or (seulement is not None and t.id not in seulement):
            continue
        pts = [((x - x0) * echelle, (y - y0) * echelle) for x, y in t.pts]
        if len(pts) > 1:
            d.line(pts, fill=(25, 25, 25), width=trait_px, joint="curve")
        else:
            r = trait_px / 2
            d.ellipse([pts[0][0] - r, pts[0][1] - r, pts[0][0] + r, pts[0][1] + r], fill=(25, 25, 25))
    police = _police(max(15, round(0.95 * h * echelle)))
    marge = 0.3 * h
    for g in groupes if cadres else []:
        if g.y1 < y0 or g.y0 > y1:
            continue
        r = [(g.x0 - marge - x0) * echelle, (g.y0 - marge - y0) * echelle, (g.x1 + marge - x0) * echelle, (g.y1 + marge - y0) * echelle]
        d.rectangle(r, outline=CADRE, width=max(2, trait_px))
        tb = d.textbbox((0, 0), g.id, font=police)
        lw, lh = tb[2] - tb[0] + 8, tb[3] - tb[1] + 8
        lx, ly = r[0] - lw - 3, max(0, r[1])  # à gauche du cadre : ne masque pas l'écriture de la ligne au-dessus
        if lx < 0:
            lx = 0
        d.rectangle([lx, ly, lx + lw, ly + lh], fill=CADRE)
        d.text((lx + 4, ly + 2 - tb[1]), g.id, fill="white", font=police)
    img.save(chemin)
    return img.size


def rendre_page(traits, groupes, h: float, dossier: Path, prefixe: str, bandes: int = 1) -> list[Path]:
    """Une image (bandes = 1) ou plusieurs bandes horizontales. Renvoie les chemins, de haut en bas."""
    dossier.mkdir(parents=True, exist_ok=True)
    gx0 = min(g.x0 for g in groupes) - 2 * h
    gx1 = max(g.x1 for g in groupes) + 2 * h
    haut = min(g.y0 for g in groupes) - 2 * h
    bas = max(g.y1 for g in groupes) + 2 * h
    limites = [haut, *coupures(groupes, bandes), bas]
    chemins: list[Path] = []
    for i in range(len(limites) - 1):
        chemin = dossier / (f"{prefixe}.png" if len(limites) == 2 else f"{prefixe}_{i + 1}.png")
        a, b = limites[i], limites[i + 1]
        rendre_zone(traits, groupes, h, (gx0, a - (0 if i == 0 else 0.5 * h), gx1, b + (0 if i == len(limites) - 2 else 0.5 * h)), chemin)
        chemins.append(chemin)
    return chemins
