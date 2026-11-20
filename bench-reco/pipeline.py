"""Chaîne de lecture partagée par le serveur et les scripts d'essai : feuille JSON → groupes lus par TexTeller."""
from __future__ import annotations

import hashlib
import json
import re
import tempfile
import threading
import time
from collections import Counter, OrderedDict
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import numpy as np
from PIL import Image

from benchreco import reco
from benchreco.reco import plafond_tokens
from benchreco.config import Config
from benchreco.feuille import Feuille, charger_feuille, estimer_hauteur
from benchreco.groupement import Groupe, regrouper
from benchreco.rendu import rendre_groupe

HAUTEUR_PX = 128  # 128 et 256 donnent les mêmes lectures (voir README)


@dataclass
class GroupeLu:
    id: str
    x0: float
    y0: float
    x1: float
    y1: float
    latex: str | None  # None : groupe non lu (règle de séparation)
    type_probable: str  # formule | texte | figure | regle — simple indication, pas un filtre
    couleur: str
    nb_traits: int
    image: Image.Image | None = field(default=None, repr=False)
    rendre: Callable[[int], Image.Image] | None = field(default=None, repr=False)  # image à une hauteur donnée (vérification)
    statut: str = "ok"  # "lecture_echouee" : la génération a bouclé ou atteint son plafond, latex non fiable
    raison: str | None = None  # "boucle" | "plafond"
    tokens: int | None = None
    empreinte: str = ""  # identifie la ligne tant qu'elle n'est pas réécrite (voir `empreinte`)
    traits_ids: list[str] = field(default_factory=list, repr=False)  # identifiants des traits du groupe

    def vers_json(self) -> dict:
        """Forme renvoyée à l'app."""
        return {
            "id": self.id, "x0": self.x0, "y0": self.y0, "x1": self.x1, "y1": self.y1,
            "latex": self.latex or "" if self.statut == "ok" else "", "type": self.type_probable, "statut": self.statut, "empreinte": self.empreinte,
        }


def nettoyer(latex: str) -> str:
    """TexTeller renvoie \\[ … \\] avec des retours à la ligne : on garde le contenu."""
    s = re.sub(r"^\\\[|\\\]$", "", latex.strip()).strip()
    return re.sub(r"\s*\n\s*", " ", s)


def deviner_type(g: Groupe, latex: str | None, h: float) -> str:
    """Heuristique grossière (indication seulement) : règle, figure (très haut), texte (longs mots de lettres), sinon formule."""
    if g.bruit:
        return "regle"
    if g.h > 5 * h:
        return "figure"
    sans_commandes = re.sub(r"\\[a-zA-Z]+", " ", latex or "")
    if re.search(r"[A-Za-zÀ-ÿ]{5,}", sans_commandes):
        return "texte"
    return "formule"


def _normaliser_couleur(c: str) -> str:
    return c.strip().lower()


def filtrer_couleurs(feuille: Feuille, ignorer: list[str]) -> int:
    """Retire de la feuille les traits des couleurs données ; renvoie le nombre de traits retirés."""
    bannies = {_normaliser_couleur(c) for c in ignorer}
    if not bannies:
        return 0
    avant = len(feuille.traits)
    feuille.traits = [t for t in feuille.traits if _normaliser_couleur(t.couleur) not in bannies]
    for i, t in enumerate(feuille.traits):
        t.idx = i
    if not feuille.traits:
        raise ValueError("tous les traits sont d'une couleur ignorée")
    return avant - len(feuille.traits)


@dataclass
class StatsLecture:
    """Ce qu'a fait une lecture : combien de groupes relus par le modèle, repris du cache, tokens générés."""

    lus: int = 0
    cache: int = 0
    echecs: int = 0
    tokens: int = 0
    annulee: bool = False
    duree_s: float = 0.0


def empreinte(feuille: Feuille, indices: list[int]) -> str:
    """Empreinte d'un groupe : géométrie de ses traits (coordonnées arrondies au dixième, comme dans le format léger de l'app).

    Indépendante des identifiants, des couleurs et des autres groupes : un groupe inchangé garde la même empreinte.
    Indépendante aussi de la hauteur sur la feuille (le haut du groupe sert d'origine verticale) : une ligne descendue pour faire de la place
    (« + de place », explication écrite sous une ligne) reste la même ligne. La position horizontale compte."""
    h = hashlib.sha1()
    pts = [np.round(feuille.traits[i].pts, 1) for i in indices]
    haut = min((p[:, 1].min() for p in pts if len(p)), default=0.0)
    for p in pts:
        q = p.copy()
        q[:, 1] = np.round(q[:, 1] - haut, 1)  # arrondi de nouveau : un décalage entier ne laisse aucun bruit de virgule flottante
        h.update(q.astype("<f4").tobytes())
        h.update(b"|")
    return h.hexdigest()


class Lecteur:
    """Charge TexTeller une fois ; un seul calcul à la fois (CPU) ; cache des lectures par empreinte de groupe."""

    CACHE_MAX = 3000

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.modele = reco.creer("texteller", cfg.reco)
        self._verrou = threading.Lock()  # une inférence à la fois
        self._petit_verrou = threading.Lock()  # compteurs et cache
        self.cache: OrderedDict[str, tuple[str, str, str | None, int | None]] = OrderedDict()
        self.version = 0  # incrémentée à chaque requête : une lecture en arrière-plan plus ancienne s'arrête
        self.prioritaires = 0  # corrections en cours : la lecture en arrière-plan leur cède la place

    def charger(self) -> None:
        self.modele.telecharger()
        self.modele.charger()

    def nouvelle_requete(self) -> int:
        with self._petit_verrou:
            self.version += 1
            return self.version

    @contextmanager
    def prioritaire(self):
        """Pendant une correction demandée par l'élève, la lecture en arrière-plan s'efface."""
        with self._petit_verrou:
            self.prioritaires += 1
        try:
            yield
        finally:
            with self._petit_verrou:
                self.prioritaires -= 1

    def _cherche(self, cle: str):
        with self._petit_verrou:
            v = self.cache.get(cle)
            if v is not None:
                self.cache.move_to_end(cle)
            return v

    def _range(self, cle: str, valeur) -> None:
        with self._petit_verrou:
            self.cache[cle] = valeur
            self.cache.move_to_end(cle)
            while len(self.cache) > self.CACHE_MAX:
                self.cache.popitem(last=False)

    def lire(
        self,
        brut: dict,
        ignorer_couleurs: list[str] | None = None,
        annuler: Callable[[], bool] | None = None,
        stats: StatsLecture | None = None,
        ocr: bool = True,
    ) -> tuple[Feuille, float, list[GroupeLu]]:
        """Regroupe la feuille et lit chaque groupe (cache d'abord). `annuler()` vrai : on s'arrête avant le groupe suivant
        (les groupes déjà lus restent en cache) et la liste renvoyée est partielle. `stats` est rempli si fourni.
        `ocr=False` : regroupement seulement (entrée « image » : TexTeller n'est pas utilisé), latex vide."""
        t0 = time.perf_counter()
        stats = stats if stats is not None else StatsLecture()
        # charger_feuille lit un fichier : on réutilise tel quel plutôt que de dupliquer la validation.
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
            json.dump(brut, f)
            chemin = f.name
        try:
            feuille = charger_feuille(chemin)
        finally:
            Path(chemin).unlink(missing_ok=True)
        filtrer_couleurs(feuille, ignorer_couleurs if ignorer_couleurs is not None else list(self.cfg.correction.ignorer_couleurs))
        h = estimer_hauteur(feuille.traits, self.cfg.echelle.centile)
        groupes = regrouper(feuille.traits, self.cfg.groupement, h)
        plafond_actif = getattr(self.cfg.reco, "plafond_actif", False)
        sortie: list[GroupeLu] = []
        for g in groupes:
            if annuler is not None and annuler():
                stats.annulee = True
                break
            couleurs = Counter(feuille.traits[i].couleur for i in g.indices)
            image = latex = None
            statut, raison, tokens = "ok", None, None
            cle = "" if g.bruit else empreinte(feuille, g.indices)
            if not g.bruit:
                image = rendre_groupe(feuille.traits, g, h, self.cfg.rendu, HAUTEUR_PX)
                if not ocr:
                    latex = ""
            if not g.bruit and ocr:
                connu = self._cherche(cle)
                if connu is not None:
                    latex, statut, raison, tokens = connu
                    stats.cache += 1
                else:
                    with self._verrou:
                        if annuler is not None and annuler():  # annulé pendant l'attente du verrou
                            stats.annulee = True
                            break
                        plafond = plafond_tokens(g.w / h, self.cfg.reco) if plafond_actif else None
                        lecture = self.modele.lire(image, max_tokens=plafond)
                    latex, statut, raison, tokens = nettoyer(lecture.latex), lecture.statut, lecture.raison, lecture.tokens
                    self._range(cle, (latex, statut, raison, tokens))
                    stats.lus += 1
                    stats.tokens += tokens or 0
                    stats.echecs += statut != "ok"
            rendre = None if g.bruit else (lambda hp, g=g: rendre_groupe(feuille.traits, g, h, self.cfg.rendu, hp))
            sortie.append(
                GroupeLu(g.id, g.x0, g.y0, g.x1, g.y1, latex, deviner_type(g, latex, h), couleurs.most_common(1)[0][0], len(g.indices),
                         image, rendre, statut, raison, tokens, cle, [feuille.traits[i].id for i in g.indices])
            )
        stats.duree_s = round(time.perf_counter() - t0, 2)
        return feuille, h, sortie
