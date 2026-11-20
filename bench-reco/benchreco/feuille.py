"""Lecture de la feuille exportée par l'app et boîtes englobantes des traits."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np


@dataclass
class Trait:
    idx: int  # position dans la liste filtrée
    id: str
    couleur: str
    epaisseur: float
    pts: np.ndarray  # (n, 2) en unités feuille
    pression: np.ndarray  # (n,)
    debut: float  # secondes
    fin: float
    x0: float = field(init=False)
    y0: float = field(init=False)
    x1: float = field(init=False)
    y1: float = field(init=False)

    def __post_init__(self):
        self.x0, self.y0 = self.pts.min(axis=0)
        self.x1, self.y1 = self.pts.max(axis=0)

    @property
    def w(self) -> float:
        return float(self.x1 - self.x0)

    @property
    def h(self) -> float:
        return float(self.y1 - self.y0)

    @property
    def cx(self) -> float:
        return float((self.x0 + self.x1) / 2)

    @property
    def cy(self) -> float:
        return float((self.y0 + self.y1) / 2)


@dataclass
class Feuille:
    traits: list[Trait]
    largeur: float
    fond: str
    ignores: int  # traits non retenus (autre outil, vides)


def charger_feuille(chemin: str | Path) -> Feuille:
    """Charge le JSON de l'app. Seuls les traits de stylo sont gardés."""
    with open(chemin, encoding="utf-8") as f:
        brut = json.load(f)
    if isinstance(brut, list):  # tolère une simple liste de traits
        brut = {"traits": brut}
    if not isinstance(brut, dict) or not isinstance(brut.get("traits"), list):
        raise ValueError("JSON invalide : liste « traits » absente")

    traits: list[Trait] = []
    ignores = 0
    for t in brut["traits"]:
        pts = [p for p in t.get("points", []) if len(p) >= 2]
        if t.get("outil", "stylo") != "stylo" or not pts:
            ignores += 1
            continue
        a = np.asarray([[p[0], p[1], p[2] if len(p) > 2 else 0.5, p[3] if len(p) > 3 else t.get("debut", 0)] for p in pts], float)
        debut = float(t.get("debut", a[0, 3])) / 1000.0
        fin = float(t.get("fin", a[-1, 3])) / 1000.0
        traits.append(
            Trait(
                idx=len(traits),
                id=str(t.get("id", len(traits))),
                couleur=str(t.get("couleur", "#000")),
                epaisseur=float(t.get("epaisseur", 2.0)),
                pts=a[:, :2],
                pression=a[:, 2],
                debut=debut,
                fin=max(fin, debut),
            )
        )
    if not traits:
        raise ValueError("aucun trait de stylo dans la feuille")
    return Feuille(traits, float(brut.get("largeur", 800)), str(brut.get("fond", "blanc")), ignores)


def estimer_hauteur(traits: list[Trait], centile: float = 60.0) -> float:
    """Hauteur typique d'un caractère : centile des hauteurs de traits « normaux »
    (on écarte les barres horizontales, les points et les virgules)."""
    hs = np.array([t.h for t in traits])
    ws = np.array([t.w for t in traits])
    normal = (ws <= 2.5 * np.maximum(hs, 1e-6)) & (hs > 0)
    cand = hs[normal] if normal.any() else hs
    med = float(np.median(cand))
    cand = cand[cand >= 0.4 * med]
    return max(float(np.percentile(cand, centile)), 1e-3)
