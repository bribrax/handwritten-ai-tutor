"""Banc de test de reconnaissance d'écriture manuscrite mathématique.

    python bench.py feuille.json [--verite verite.json] [--sans-reco] [--modeles pix2text,texteller]

Produit sorties/<feuille>/rapport.html et resultats.json.
"""
from __future__ import annotations

import argparse
import json
import platform
import sys
import time
from pathlib import Path

from benchreco.config import Config
from benchreco.feuille import charger_feuille, estimer_hauteur
from benchreco.groupement import regrouper
from benchreco.metriques import comparer
from benchreco.reco import plafond_tokens
from benchreco.rapport import Contexte, InfoModele, Resultat, generer
from benchreco.rendu import apercu_page, rendre_groupe


def lire_verite(chemin: str, groupes_ids: set[str]) -> dict[str, str]:
    """verite.json : { "G1": "f'(x)=...", "G2": "..." } — les clés sont les identifiants du rapport."""
    with open(chemin, encoding="utf-8") as f:
        brut = json.load(f)
    if not isinstance(brut, dict):
        raise SystemExit("verite.json doit être un objet { \"G1\": \"latex\", … }")
    verite: dict[str, str] = {}
    for k, v in brut.items():
        cle = str(k).strip().upper()
        if isinstance(v, dict):  # tolère { "G1": { "latex": "…" } }
            v = v.get("latex", "")
        if not isinstance(v, str):
            raise SystemExit(f"vérité {k} : une chaîne LaTeX est attendue")
        verite[cle] = v
    inconnus = sorted(set(verite) - groupes_ids)
    if inconnus:
        print(f"⚠ vérité ignorée pour des groupes absents de la feuille : {', '.join(inconnus)}", file=sys.stderr)
    return verite


def systeme() -> str:
    # platform.release() annonce « 10 » sur Windows 11 : on se fie au numéro de build.
    if platform.system() == "Windows" and int(platform.version().split(".")[-1]) >= 22000:
        return "Windows 11"
    return f"{platform.system()} {platform.release()}"


def machine() -> str:
    import os

    import torch

    cpu = platform.processor() or platform.machine()
    try:
        import cpuinfo  # type: ignore

        cpu = cpuinfo.get_cpu_info().get("brand_raw", cpu)
    except Exception:
        pass
    return f"{cpu} — {os.cpu_count()} threads logiques (torch : {torch.get_num_threads()}), {systeme()}, Python {platform.python_version()}, CPU uniquement"


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("feuille", help="JSON exporté par l'app")
    ap.add_argument("--verite", help="JSON { \"G1\": \"latex\", … } (les identifiants sont ceux du rapport)")
    ap.add_argument("--config", help="config.toml alternatif")
    ap.add_argument("--modeles", help="liste séparée par des virgules (défaut : config.toml)")
    ap.add_argument("--hauteurs", help="hauteurs d'image en px, séparées par des virgules (défaut : config.toml)")
    ap.add_argument("--sortie", help="dossier de sortie (défaut : sorties/<nom de la feuille>)")
    ap.add_argument("--sans-plafond", action="store_true", help="TexTeller sans plafond de tokens adaptatif ni détection de boucle (comportement d'origine)")
    ap.add_argument("--sans-reco", action="store_true", help="regroupement et rendu seulement (réglage des seuils, très rapide)")
    args = ap.parse_args(argv)

    cfg = Config.charger(args.config)
    feuille = charger_feuille(args.feuille)
    auto = cfg.echelle.hauteur_caractere <= 0
    h = estimer_hauteur(feuille.traits, cfg.echelle.centile) if auto else cfg.echelle.hauteur_caractere
    groupes = regrouper(feuille.traits, cfg.groupement, h)
    lisibles = [g for g in groupes if not g.bruit]
    print(f"{len(feuille.traits)} traits → {len(lisibles)} groupes (h = {h:.1f}{' estimée' if auto else ''}, {len(groupes) - len(lisibles)} bruit)")

    hauteurs = [int(x) for x in args.hauteurs.split(",")] if args.hauteurs else [int(x) for x in cfg.rendu.hauteurs]
    images = {(g.id, hp): rendre_groupe(feuille.traits, g, h, cfg.rendu, hp) for g in lisibles for hp in hauteurs}

    verite = lire_verite(args.verite, {g.id for g in lisibles}) if args.verite else None
    avert = []
    if verite is not None:
        manquants = [g.id for g in lisibles if g.id not in verite]
        if manquants:
            avert.append(f"Pas de vérité pour : {', '.join(manquants)} (exclus des scores).")

    resultats: list[Resultat] = []
    infos: list[InfoModele] = []
    if not args.sans_reco:
        from benchreco import reco

        noms = [m.strip() for m in (args.modeles or ",".join(cfg.reco.modeles)).split(",") if m.strip()]
        premiere = images[(lisibles[0].id, hauteurs[0])]
        for nom in noms:
            try:
                modele = reco.creer(nom, cfg.reco)
            except Exception as e:
                infos.append(InfoModele(nom, "", erreur=f"modèle inconnu : {e}"))
                continue
            print(f"[{modele.nom}] chargement…", flush=True)
            info = InfoModele(modele.nom, "")
            try:
                print(f"[{modele.nom}] téléchargement des poids si nécessaire (non compté)…", flush=True)
                modele.telecharger()
                t = time.perf_counter()
                modele.charger()
                info.import_s = modele.import_s
                info.chargement_s = time.perf_counter() - t - modele.import_pendant_charger
                info.detail = modele.detail()
                t = time.perf_counter()
                modele.lire(premiere)  # préchauffage : 1ʳᵉ inférence (allocations, JIT), non comptée dans les temps
                info.prechauffage_s = time.perf_counter() - t
                print(f"[{modele.nom}] chargé en {info.chargement_s:.1f} s, préchauffage {info.prechauffage_s:.1f} s", flush=True)
            except Exception as e:
                info.erreur = f"{type(e).__name__}: {e}"
                infos.append(info)
                print(f"[{modele.nom}] ÉCHEC : {info.erreur}", file=sys.stderr)
                continue
            infos.append(info)
            for g in lisibles:
                for hp in hauteurs:
                    r = Resultat(g.id, hp, modele.nom)
                    try:
                        t = time.perf_counter()
                        plafond = plafond_tokens(g.w / h, cfg.reco) if getattr(cfg.reco, "plafond_actif", False) and not args.sans_plafond else None
                        lecture = modele.lire(images[(g.id, hp)], max_tokens=plafond)
                        r.duree_ms = (time.perf_counter() - t) * 1000
                        r.latex, r.confiance = lecture.latex, lecture.confiance
                        r.tokens, r.statut, r.raison = lecture.tokens, lecture.statut, lecture.raison
                        if verite is not None and g.id in verite:
                            r.score = comparer(r.latex, verite[g.id])
                    except Exception as e:
                        r.erreur = f"{type(e).__name__}: {e}"
                    resultats.append(r)
                    print(f"  {g.id} @{hp:>3}px  {r.duree_ms:7.0f} ms  {r.latex if not r.erreur else 'ERREUR ' + r.erreur}", flush=True)

    ctx = Contexte(
        fichier=Path(args.feuille).name,
        nb_traits=len(feuille.traits),
        nb_ignores=feuille.ignores,
        h=h,
        h_auto=auto,
        groupes=groupes,
        apercu=apercu_page(feuille.traits, groupes, h),
        images=images,
        resultats=resultats,
        modeles=infos,
        verite=verite,
        hauteurs=hauteurs,
        machine=machine(),
        ratio_max=cfg.rendu.largeur_max_ratio,
        avertissements=avert,
    )
    sortie = Path(args.sortie) if args.sortie else Path(__file__).resolve().parent / "sorties" / Path(args.feuille).stem
    sortie.mkdir(parents=True, exist_ok=True)
    (sortie / "rapport.html").write_text(generer(ctx), encoding="utf-8")
    (sortie / "resultats.json").write_text(
        json.dumps(
            {
                "feuille": args.feuille,
                "h": h,
                "groupes": [{"id": g.id, "traits": g.indices, "bruit": g.bruit, "structures": g.structures} for g in groupes],
                "modeles": [vars(i) for i in infos],
                "resultats": [
                    {**{k: v for k, v in vars(r).items() if k != "score"}, "score": vars(r.score) if r.score else None} for r in resultats
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nRapport : {sortie / 'rapport.html'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
