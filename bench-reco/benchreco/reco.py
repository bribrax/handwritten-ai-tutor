"""Adaptateurs des modèles de reconnaissance : image (PIL) → LaTeX.

Chaque modèle expose : telecharger() (hors chronométrage), charger() (chronométré), lire(image), detail().
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass
from importlib.metadata import version
from pathlib import Path

os.environ.setdefault("TQDM_DISABLE", "1")  # pas de barre de progression à chaque lecture
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

from PIL import Image

import logging

logging.getLogger("transformers").setLevel(logging.ERROR)  # supprime les longs dumps de configuration


@dataclass
class Lecture:
    latex: str
    confiance: float | None = None  # moyenne géométrique des probabilités des symboles, si le modèle la fournit
    tokens: int | None = None  # nombre de tokens générés (TexTeller)
    statut: str = "ok"  # "ok" | "lecture_echouee" : la génération a bouclé ou atteint son plafond, le LaTeX n'est pas fiable
    raison: str | None = None  # "boucle" | "plafond" quand statut == "lecture_echouee"


def plafond_tokens(largeur_en_h: float, cfg) -> int:
    """Plafond de tokens d'un groupe selon sa largeur (en unités de h) : une ligne saine produit au plus ~2,5 tokens par
    unité de h (mesuré sur les groupes notés de feuille_1 et feuille_2) ; la formule garde ≥ 1,5× de marge."""
    base, par_h = float(cfg.tokens_base), float(cfg.tokens_par_h)
    return int(min(float(cfg.tokens_max), max(float(cfg.tokens_min), base + par_h * largeur_en_h)))


def motif_repete(ids: list[int], repetitions: int = 3, nmax: int = 12, repetitions_unigramme: int = 8) -> list[int] | None:
    """Renvoie le motif si la fin de `ids` répète plus de `repetitions` fois consécutives un même n-gramme (n ≤ nmax).

    Un token seul exige `repetitions_unigramme` copies (des chiffres ou « = » répétés sont légitimes plus souvent)."""
    for n in range(1, nmax + 1):
        copies = repetitions_unigramme if n == 1 else repetitions + 1
        if len(ids) < n * copies:
            continue
        motif = ids[-n:]
        if all(ids[-n * (k + 1) : len(ids) - n * k] == motif for k in range(copies)):
            return motif
    return None


class Modele:
    nom = "?"
    import_s = 0.0  # temps d'import Python du paquet (rapporté à part)
    import_pendant_charger = 0.0  # part de import_s comprise dans la durée de charger()

    def telecharger(self) -> None:  # noqa: D401
        """Télécharge les poids (non chronométré)."""

    def charger(self) -> None:
        raise NotImplementedError

    def lire(self, img: Image.Image, max_tokens: int | None = None) -> Lecture:
        raise NotImplementedError

    def detail(self) -> str:
        return ""


def _threads(n: int) -> None:
    if n and n > 0:
        import torch

        torch.set_num_threads(n)


class Pix2TextMFR(Modele):
    """Pix2Text, modèle de formules (MFR) seul : pas de détection de mise en page ni d'OCR de texte."""

    def __init__(self, nom_modele: str = "mfr-1.5", threads: int = 0):
        # Seuls les modèles `mfr` et `mfr-1.5` en ONNX sont gratuits (MIT) ; les variantes PyTorch, pro et plus sont payantes.
        self.nom_modele = nom_modele
        self.nom = f"pix2text-{nom_modele}"
        self.threads = threads
        self.dossier: Path | None = None

    def _info(self):
        from pix2text.consts import AVAILABLE_MODELS

        return AVAILABLE_MODELS.get_info(self.nom_modele, "onnx")

    def telecharger(self) -> None:
        t = time.perf_counter()
        from pix2text.consts import MODEL_VERSION  # importer pix2text charge tout le paquet (mise en page, OCR…)
        from pix2text.utils import data_dir, prepare_model_files2

        self.import_s = time.perf_counter() - t

        info = self._info()
        if info is None:
            raise ValueError(f"modèle Pix2Text introuvable : {self.nom_modele}")
        self.dossier = Path(data_dir()) / MODEL_VERSION / info["local_model_id"]
        if not (self.dossier.is_dir() and list(self.dossier.glob("**/[!.]*"))):
            prepare_model_files2(model_fp_or_dir=self.dossier, remote_repo=info["hf_model_id"], file_or_dir="dir")

    def charger(self) -> None:
        from pix2text.latex_ocr import LatexOCR  # déjà importé (voir telecharger) : coût nul ici

        _threads(self.threads)
        self.modele = LatexOCR(model_name=self.nom_modele, model_backend="onnx", device="cpu")

    def lire(self, img: Image.Image, max_tokens: int | None = None) -> Lecture:  # max_tokens : sans effet ici
        out = self.modele.recognize(img)
        return Lecture(out["text"].strip(), float(out["score"]))

    def detail(self) -> str:
        info = self._info() or {}
        return f"pix2text {version('pix2text')} · poids {info.get('hf_model_id', '?')} (ONNX, CPU)"


class TexTeller(Modele):
    nom = "texteller"
    DEPOT = "OleehyO/TexTeller"

    def __init__(self, backend: str = "pytorch", threads: int = 0):
        self.backend = backend
        self.threads = threads
        self.boucle_repetitions = 3

    def telecharger(self) -> None:
        from huggingface_hub import snapshot_download

        if self.backend == "onnx":
            motifs = ["*.json", "*.txt", "encoder_model.onnx", "decoder_model_merged.onnx"]
        else:  # on évite pytorch_model.bin et les ONNX (plusieurs Go inutiles)
            motifs = ["*.json", "*.txt", "model.safetensors"]
        snapshot_download(self.DEPOT, allow_patterns=motifs)

    def charger(self) -> None:
        import numpy as np
        import torch

        t = time.perf_counter()
        from texteller import img2latex, load_model, load_tokenizer

        self.import_s = self.import_pendant_charger = time.perf_counter() - t
        self._np = np
        self._img2latex = img2latex
        _threads(self.threads)
        self.device = torch.device("cpu")
        self.modele = load_model(use_onnx=self.backend == "onnx")
        self.tokenizer = load_tokenizer()
        if self.backend != "onnx":
            self.modele.eval()

    def lire(self, img: Image.Image, max_tokens: int | None = None) -> Lecture:
        """Même chaîne que texteller.img2latex (prétraitement, génération gloutonne num_beams=1, décodage, formatage),
        avec un plafond de tokens et l'arrêt sur boucle. `max_tokens=None` : comportement d'origine (1024, sans détection)."""
        import torch
        from texteller.api.format import format_latex
        from texteller.constants import MAX_TOKEN_SIZE
        from texteller.utils import add_newlines, remove_style, transform
        from transformers import GenerationConfig, StoppingCriteria, StoppingCriteriaList

        plafond = max_tokens or MAX_TOKEN_SIZE
        detecter = max_tokens is not None
        repetitions = int(getattr(self, "boucle_repetitions", 3))

        class ArretSurBoucle(StoppingCriteria):
            declenche = False

            def __call__(self, input_ids, scores, **kwargs):
                stop = motif_repete(input_ids[0].tolist(), repetitions) is not None
                if stop:
                    self.declenche = True
                return torch.tensor([stop] * input_ids.shape[0], dtype=torch.bool, device=input_ids.device)

        arret = ArretSurBoucle()
        gen = GenerationConfig(
            max_new_tokens=plafond, num_beams=1, do_sample=False, no_repeat_ngram_size=0,
            pad_token_id=self.tokenizer.pad_token_id, eos_token_id=self.tokenizer.eos_token_id, bos_token_id=self.tokenizer.bos_token_id,
        )
        pixel_values = torch.stack(transform([self._np.asarray(img.convert("RGB"))]))
        with torch.inference_mode():
            pred = self.modele.generate(
                pixel_values.to(self.modele.device), generation_config=gen, stopping_criteria=StoppingCriteriaList([arret]) if detecter else None
            )
        ids = pred[0].tolist()
        tokens = len(ids) - 1  # sans le token de départ
        latex = self.tokenizer.batch_decode(pred, skip_special_tokens=True)[0]
        latex = add_newlines(format_latex(remove_style(latex))).strip()
        eos = self.tokenizer.eos_token_id
        if arret.declenche:
            return Lecture(latex, tokens=tokens, statut="lecture_echouee", raison="boucle")
        if detecter and eos not in ids[1:]:  # fini par épuisement du plafond, pas par la fin de séquence
            return Lecture(latex, tokens=tokens, statut="lecture_echouee", raison="plafond")
        return Lecture(latex, tokens=tokens)

    def detail(self) -> str:
        return f"texteller {version('texteller')} · poids {self.DEPOT} ({self.backend}, CPU)"


def creer(nom: str, cfg) -> Modele:
    threads = int(getattr(cfg, "threads", 0))
    if nom == "pix2text":
        return Pix2TextMFR(cfg.pix2text_modele, threads)
    if nom == "texteller":
        m = TexTeller(getattr(cfg, "texteller_backend", "pytorch"), threads)
        m.boucle_repetitions = int(getattr(cfg, "boucle_repetitions", 3))
        return m
    raise ValueError(f"{nom!r} (disponibles : pix2text, texteller)")
