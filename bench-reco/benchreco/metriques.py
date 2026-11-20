"""Comparaison de LaTeX prédit et de la vérité terrain."""
from __future__ import annotations

import re
from dataclasses import dataclass

from rapidfuzz.distance import Levenshtein

_TOKEN = re.compile(r"\\[A-Za-z]+|\\.|.", re.S)

# Écritures LaTeX équivalentes qu'on ne veut pas compter comme des erreurs.
_REMPLACEMENTS = [
    (r"\\(?:displaystyle|textstyle|scriptstyle|scriptscriptstyle)(?![A-Za-z])", ""),
    (r"\\[,;:!> ]|\\quad(?![A-Za-z])|\\qquad(?![A-Za-z])", ""),
    (r"\\(?:left|right|bigl|bigr|Bigl|Bigr|biggl|biggr|big|Big|bigg|Bigg)(?![A-Za-z])", ""),
    (r"\\[dt]frac(?![A-Za-z])", r"\\frac"),
    (r"\\(?:mathrm|operatorname|text|mathit)\{([^{}]*)\}", r"\1"),
    (r"\\(?:dots|ldots|cdots)(?![A-Za-z])", r"\\ldots"),
    (r"\\le(?![A-Za-z])", r"\\leq"),
    (r"\\ge(?![A-Za-z])", r"\\geq"),
    (r"\\ne(?![A-Za-z])", r"\\neq"),
    (r"\s+", ""),
]


def normaliser(latex: str) -> str:
    s = latex.strip()
    # Délimiteurs d'affichage ajoutés par certains modèles : \[ … \], $$ … $$, $ … $
    s = re.sub(r"^(?:\\\[|\$\$|\$)|(?:\\\]|\$\$|\$)$", "", s.strip()).strip()
    for motif, rempl in _REMPLACEMENTS:
        s = re.sub(motif, rempl, s)
    # a^{2} == a^2 et x_{i} == x_i : accolades inutiles autour d'un seul symbole.
    s = re.sub(r"([\^_])\{(\\[A-Za-z]+|[^{}\\])\}", r"\1\2", s)
    return s


def _tokens(s: str) -> list[str]:
    return _TOKEN.findall(s)


@dataclass
class Score:
    exact: bool  # égal après normalisation
    cer: float  # distance d'édition au niveau caractère / longueur de la référence
    ter: float  # idem au niveau des symboles LaTeX (\frac, x, ^, …)
    distance: int  # distance d'édition caractère


def comparer(prediction: str, verite: str) -> Score:
    p, v = normaliser(prediction), normaliser(verite)
    d = Levenshtein.distance(p, v)
    dt = Levenshtein.distance(_tokens(p), _tokens(v))
    return Score(exact=p == v, cer=d / max(len(v), 1), ter=dt / max(len(_tokens(v)), 1), distance=d)
