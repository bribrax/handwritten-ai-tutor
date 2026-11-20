"""Reprise d'une correction : l'élève précise ce qu'il a écrit, répond à une lecture douteuse ou discute avec le tuteur.

Claude reçoit la feuille (bandes), un gros plan des lignes concernées, éventuellement une zone montrée par l'élève, les annotations actuelles
et le message ; il répond par un message et une MISE À JOUR des annotations (celles à créer ou remplacer, et celles à retirer).
Chaque appel est indépendant : l'historique compact est renvoyé à chaque message (pas de `--resume`).
"""
from __future__ import annotations

import json
import time
from pathlib import Path

from correction import (
    CONSIGNE_BLOCS, CONSIGNE_PHOTOS, CONSIGNE_PRECISIONS, SCHEMA, ErreurCorrection, ErreurSchema, _dossier_log, _ecrire, creer_backend, decrire, prompt_systeme, tokens_entree, valider,
    valider_explications,
)

SCHEMA_REPRISE = {
    "type": "object",
    "properties": {
        "message": {"type": "string", "description": "réponse courte à l'élève, en français"},
        "annotations": SCHEMA["properties"]["annotations"],
        "explications": SCHEMA["properties"]["explications"],
        "retirer": {"type": "array", "items": {"type": "string"}, "description": "identifiants (G…) des groupes dont l'annotation actuelle doit disparaître"},
        "lecture_corrigee": {"type": "string", "description": "LaTeX de la ligne concernée telle que l'élève l'a écrite, si sa précision corrige ta lecture (sinon chaîne vide)"},
    },
    "required": ["message", "annotations", "retirer"],
}

REPRISE = """

MODE REPRISE. Tu as déjà corrigé la feuille ; tes annotations actuelles te sont fournies (champ annotations_actuelles, une par groupe). L'élève te répond maintenant : soit il précise ce qu'il a écrit (precision_eleve, qui FAIT FOI sur ce qui est écrit), soit il t'écrit un message (message_eleve). Les images jointes sont la feuille (bandes numérotées), puis un gros plan de la ou des lignes concernées, éventuellement une zone que l'élève te montre.
Tu réponds par {"message", "annotations", "retirer", "lecture_corrigee"} et, si utile, "explications" (paragraphes écrits à la main sous une ligne : c'est le bon moyen de répondre à une question de l'élève qui demande de développer, d'expliquer une méthode ou de reprendre un calcul ; « message » reste court et renvoie vers l'explication) :
- message : réponse courte, en français, adressée à l'élève (une à deux phrases, davantage seulement si le ton demandé est détaillé) ;
- annotations : SEULEMENT celles à créer ou à remplacer (une par groupe concerné, mêmes types que d'habitude, « groupe » = identifiant G…) ;
- retirer : identifiants des groupes dont l'annotation actuelle doit disparaître (par exemple une erreur annoncée à tort à cause d'une mauvaise lecture). Si la ligne est juste, tu peux la remplacer par une annotation « ok » plutôt que la retirer ;
- lecture_corrigee : si la précision de l'élève corrige ta lecture d'une ligne, le LaTeX de la ligne entière tel qu'il l'a écrit ; sinon chaîne vide.
Règles : après une précision, relis la ligne avec la lecture de l'élève : si la faute que tu avais signalée venait de ta lecture, retire-la (ou remplace-la par ok) ; si elle subsiste malgré la lecture corrigée, maintiens-la en l'expliquant. Ne touche pas aux groupes non concernés. Si l'élève conteste une erreur et que tu avais tort, dis-le simplement. Ne donne pas la solution complète si le mode demandé ne le permet pas."""


def valider_reprise(sortie: object, ids: set[str]) -> dict:
    if not isinstance(sortie, dict):
        raise ErreurSchema("la réponse doit être un objet JSON")
    message = sortie.get("message")
    if not isinstance(message, str) or not message.strip():
        raise ErreurSchema("« message » est absent ou vide")
    annotations = [a for a in valider({"annotations": sortie.get("annotations", [])}, ids) if a["type"] != "remarque_generale"]
    retirer = sortie.get("retirer", [])
    if not isinstance(retirer, list) or any(g not in ids for g in retirer):
        raise ErreurSchema(f"« retirer » doit contenir des groupes connus ({', '.join(sorted(ids))})")
    corrigee = sortie.get("lecture_corrigee")
    return {"message": message.strip(), "annotations": annotations, "explications": valider_explications(sortie, ids), "retirer": list(dict.fromkeys(retirer)),
            "lecture_corrigee": corrigee.strip() if isinstance(corrigee, str) else ""}


def reprendre(cfg, groupes, images: list[Path], nb_pages: int, annotations_actuelles: list[dict], cibles: list[str], precision: dict | None,
              message: str | None, historique: list[dict], enonce: str | None, mode: str | None, ton: str | None, zone: str = "feuille",
              precisions: dict[str, str] | None = None, photos: list[Path] | None = None, blocs: list[dict] | None = None) -> dict:
    """Un échange avec le tuteur. Lève ErreurCorrection (message clair) si Claude échoue ou reste invalide après une relance."""
    from correction import MODES, TONS, ZONES

    mode = mode if mode in MODES else cfg.mode
    ton = ton if ton in TONS else cfg.ton
    zone = zone if zone in ZONES else "feuille"
    backend = creer_backend(cfg)
    systeme = prompt_systeme(mode, ton, zone, "image", nb_pages)
    if precisions:
        systeme += CONSIGNE_PRECISIONS
    systeme += REPRISE
    if blocs:
        systeme += CONSIGNE_BLOCS
    photos = list(photos or [])
    if photos:
        systeme += CONSIGNE_PHOTOS
    ids = {g.id for g in groupes}
    charge = {
        "feuille": decrire(groupes, (enonce or "").strip()[:4000] or None, mode, ton, zone, "image", precisions, None, blocs),
        "annotations_actuelles": annotations_actuelles,
        "groupes_concernes": cibles,
        "precision_eleve": precision,
        "message_eleve": (message or "").strip()[:2000] or None,
        "historique": [{"role": h.get("role"), "texte": str(h.get("texte", ""))[:1500]} for h in (historique or [])[-8:]],
    }
    msg = "Reprise de la correction.\n\n" + json.dumps(charge, ensure_ascii=False)
    if photos:
        msg += "\n\nPhoto(s) de l'énoncé : " + ", ".join(Path(i).name for i in photos) + " (à lire avec l'outil Read)."
    log = _dossier_log(cfg)
    _ecrire(log / "prompt_systeme.txt", systeme)
    _ecrire(log / "requete.json", charge)
    meta: dict = {"type": "reprise", "backend": backend.nom, "modele": cfg.modele, "mode": mode, "ton": ton, "tentatives": []}
    erreur_prec = None
    try:
        for tentative in (1, 2):
            texte = msg + (f"\n\nTa réponse précédente était invalide ({erreur_prec}). Réponds de nouveau, en respectant strictement le format." if erreur_prec else "")
            rep = backend.appeler(systeme, texte, SCHEMA_REPRISE, list(images) + photos)
            usage = rep.brut.get("usage", {}) if isinstance(rep.brut, dict) else {}
            info = {"tentative": tentative, "duree_s": round(rep.duree_s, 2), "tokens_entree": tokens_entree(rep.brut), "tokens_sortie": usage.get("output_tokens"),
                    "cout_usd": rep.brut.get("total_cost_usd") if isinstance(rep.brut, dict) else None}
            _ecrire(log / f"reponse_brute_{tentative}.json", rep.brut)
            meta["tentatives"].append(info)
            try:
                res = valider_reprise(rep.structure, ids)
            except ErreurSchema as e:
                info["invalide"] = str(e)
                erreur_prec = str(e)
                continue
            meta["duree_s"] = round(sum(t["duree_s"] for t in meta["tentatives"]), 2)
            res["meta"] = meta
            _ecrire(log / "reponse.json", res)
            _ecrire(log / "meta.json", meta)
            return res
        raise ErreurCorrection(f"Claude a renvoyé deux fois une réponse invalide ({erreur_prec})")
    except ErreurCorrection as e:
        meta["erreur"] = str(e)
        _ecrire(log / "meta.json", meta)
        raise
