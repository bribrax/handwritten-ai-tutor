from __future__ import annotations

import tomllib
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace


def _ns(d: dict) -> SimpleNamespace:
    return SimpleNamespace(**{k: (_ns(v) if isinstance(v, dict) else v) for k, v in d.items()})


# Section [correction] facultative : valeurs par défaut si absente de config.toml.
CORRECTION_DEFAUT = {
    "backend": "claude-cli",
    "modele": "claude-sonnet-5-5",
    "commande": "claude",
    "delai_s": 240,
    "effort": "",
    "mode": "tout",
    "ton": "bref",
    "ignorer_couleurs": [],
    "dossier_logs": "logs",
    "entree": "image",
    "bande_hauteur_h": 24,
    "bandes_max": 8,
    "verification": False,
    "verification_parallele": 3,
    "verification_largeur_max": 1500,
}


@dataclass
class Config:
    echelle: SimpleNamespace
    groupement: SimpleNamespace
    rendu: SimpleNamespace
    reco: SimpleNamespace
    correction: SimpleNamespace

    @classmethod
    def charger(cls, chemin: str | Path | None = None) -> "Config":
        chemin = Path(chemin) if chemin else Path(__file__).resolve().parent.parent / "config.toml"
        with open(chemin, "rb") as f:
            brut = tomllib.load(f)
        corr = {**CORRECTION_DEFAUT, **brut.get("correction", {})}
        return cls(**{k: _ns(brut[k]) for k in ("echelle", "groupement", "rendu", "reco")}, correction=_ns(corr))
