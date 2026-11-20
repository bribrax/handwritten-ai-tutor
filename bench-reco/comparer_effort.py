"""Compare des façons de faire corriger la feuille par Claude, en aveugle (étiquettes A, B, C…) : effort low / défaut sur l'OCR,
image seule (page entière ou en bandes), OCR + image.

    bench-reco\.venv\Scripts\python bench-reco\comparer_effort.py                  # lance tous les essais, écrit le rapport
    bench-reco\.venv\Scripts\python bench-reco\comparer_effort.py --rapport        # refait seulement le rapport (référence remplie ensuite)
    bench-reco\.venv\Scripts\python bench-reco\comparer_effort.py --apercu-images  # écrit seulement les images envoyées (aucun appel à Claude)

Protocole : feuille_2.json, traits bleus exclus. La lecture TexTeller est FIGÉE (reprise de runs_lot1.json : même LaTeX pour tous les essais, le modèle
n'est même pas chargé) ; seul l'appel à Claude varie. Configurations × modes (tout / indice) × N exécutions, dans un ordre mélangé.

Fichiers : reference_feuille_2.json (à compléter : champ « erreur »), sorties/effort_feuille_2/runs.json, images/, rapport.html.
"""
from __future__ import annotations

import argparse
import copy
import html
import json
import random
import re
import statistics as st
import sys
import time
from datetime import datetime
from pathlib import Path

from benchreco.config import Config
from benchreco.feuille import charger_feuille, estimer_hauteur
from benchreco.groupement import regrouper
from benchreco.rendu import rendre_groupe
from correction import ErreurCorrection, corriger
from essai_correction import b64, dessiner
from page_image import rendre_page
from pipeline import GroupeLu, Lecteur, deviner_type, filtrer_couleurs

ICI = Path(__file__).resolve().parent
NOM = "feuille_2"
FEUILLE = ICI.parent / "feuille_2.json"
REFERENCE = ICI / "reference_feuille_2.json"
SORTIE = ICI / "sorties" / "effort_feuille_2"
LOT1 = SORTIE / "runs_lot1.json"  # lecture figée (feuille_2 : 1er lot de 12 essais OCR ; autres feuilles : lecture_figee.json, créée au 1er lancement)
PLAN = ICI / "plan_feuille_2.json"  # facultatif : lignes prévues et fautes volontaires, pour pré-remplir la référence
IGNORER = ["#1a56db"]


def configurer(nom: str, ignorer: list[str]) -> None:
    """Choisit la feuille étudiée : tous les fichiers (feuille, référence, sorties, lecture figée, plan) en découlent."""
    global NOM, FEUILLE, REFERENCE, SORTIE, LOT1, PLAN, IGNORER
    NOM, IGNORER = nom, ignorer
    FEUILLE = ICI.parent / f"{nom}.json"
    REFERENCE = ICI / f"reference_{nom}.json"
    SORTIE = ICI / "sorties" / f"effort_{nom}"
    LOT1 = SORTIE / ("runs_lot1.json" if nom == "feuille_2" else "lecture_figee.json")
    PLAN = ICI / f"plan_{nom}.json"


# nom → réglages. entree : ocr | image | ocr_image ; bandes : 0 = pas d'image, 1 = page entière, n = n bandes ; effort : valeur de --effort ("" = défaut).
CONFIGS = {
    "ocr_low": dict(effort="low", entree="ocr", bandes=0, titre="OCR, effort low"),
    "ocr_defaut": dict(effort="", entree="ocr", bandes=0, titre="OCR, effort par défaut"),
    "image_page": dict(effort="", entree="image", bandes=1, titre="Image seule, page entière"),
    "image_bandes": dict(effort="", entree="image", bandes=3, titre="Image seule, 3 bandes"),
    "ocr_image": dict(effort="", entree="ocr_image", bandes=1, titre="OCR + image (page entière)"),
    "image_page_low": dict(effort="low", entree="image", bandes=1, titre="Image seule, page entière, effort low"),
}
MODES = ["tout", "indice"]
LIBELLE_MODE = {"tout": "Tout corriger", "indice": "Un indice seulement"}
COULEURS = {"ok": "#16a34a", "erreur": "#d92d20", "indice": "#d97706", "lecture_douteuse": "#7c3aed", "remarque_generale": "#555"}
SIGNALE = ("erreur", "indice")  # une ligne « signalée » : annotée erreur, ou indice (mode « un indice seulement »)
ETIQUETTES = "ABCDEFGH"


# --- Lecture figée ----------------------------------------------------------------------------------------------
def groupes_figes(cfg) -> tuple[list[GroupeLu], list, float, float]:
    """Groupes de la feuille (bleu exclu) avec le LaTeX du 1er lot, sans charger TexTeller. Renvoie (groupes, traits, h, lecture_ocr_s)."""
    lot1 = json.loads(LOT1.read_text(encoding="utf-8"))
    fige = {g["id"]: g for g in lot1["groupes"]}
    feuille = charger_feuille(FEUILLE)
    filtrer_couleurs(feuille, IGNORER)
    h = estimer_hauteur(feuille.traits, cfg.echelle.centile)
    sortie: list[GroupeLu] = []
    for g in regrouper(feuille.traits, cfg.groupement, h):
        f = fige.get(g.id)
        if f is None or abs(f["x0"] - g.x0) > 0.2 or abs(f["y1"] - g.y1) > 0.2:
            raise SystemExit(f"Le regroupement a changé depuis le 1er lot (groupe {g.id}) : la lecture figée ne correspond plus.")
        couleurs = {}
        for i in g.indices:
            couleurs[feuille.traits[i].couleur] = couleurs.get(feuille.traits[i].couleur, 0) + 1
        image = None if g.bruit else rendre_groupe(feuille.traits, g, h, cfg.rendu, 128)
        rendre = None if g.bruit else (lambda hp, g=g: rendre_groupe(feuille.traits, g, h, cfg.rendu, hp))
        sortie.append(GroupeLu(g.id, g.x0, g.y0, g.x1, g.y1, f["latex"], f["type"], max(couleurs, key=couleurs.get), len(g.indices), image, rendre, f.get("statut", "ok")))
    m = re.search(r"Lecture figée : .*?, (\d+) s", (SORTIE.parent / "effort_run.log").read_text(encoding="utf-8", errors="replace")) if (SORTIE.parent / "effort_run.log").exists() else None
    return sortie, feuille.traits, h, float(lot1.get("lecture_ocr_s") or (m.group(1) if m else 27.0))


def figer_lecture(cfg) -> None:
    """Nouvelle feuille : lecture TexTeller une seule fois, enregistrée ; tous les essais réutilisent ce LaTeX."""
    print("Pas de lecture figée pour cette feuille : lecture TexTeller (une seule fois)…", flush=True)
    lecteur = Lecteur(cfg)
    lecteur.charger()
    t = time.perf_counter()
    _, _, groupes = lecteur.lire(json.loads(FEUILLE.read_text(encoding="utf-8")), IGNORER)
    LOT1.parent.mkdir(parents=True, exist_ok=True)
    LOT1.write_text(json.dumps({
        "date": datetime.now().isoformat(timespec="seconds"), "lecture_ocr_s": round(time.perf_counter() - t, 1), "ignorer": IGNORER,
        "groupes": [{"id": g.id, "x0": g.x0, "y0": g.y0, "x1": g.x1, "y1": g.y1, "latex": g.latex, "type": g.type_probable, "statut": g.statut} for g in groupes],
    }, ensure_ascii=False, indent=2), encoding="utf-8")


# --- Référence ---------------------------------------------------------------------------------------------------
def toucher_bleu(g, bleus, marge: float) -> bool:
    return any(t.x1 >= g.x0 - marge and t.x0 <= g.x1 + marge and t.y1 >= g.y0 - marge and t.y0 <= g.y1 + marge for t in bleus)


def ecrire_reference(groupes, complete, h: float) -> None:
    """Crée la référence ; si elle existe déjà, garde les champs « erreur » déjà remplis."""
    bleus = [t for t in complete.traits if t.couleur.lower() in {c.lower() for c in IGNORER}]
    ancien = {}
    if REFERENCE.exists():
        ancien = {g["id"]: g for g in json.loads(REFERENCE.read_text(encoding="utf-8")).get("groupes", [])}
    plan = json.loads(PLAN.read_text(encoding="utf-8")).get("lignes", []) if PLAN.exists() else []
    candidats = [g for g in groupes if g.type_probable != "regle"]  # lignes d'écriture, dans l'ordre de lecture
    appar: dict[str, dict] = {}
    if plan and not ancien:
        if len(candidats) == len(plan):
            appar = {g.id: p for g, p in zip(candidats, plan)}
            print(f"Référence pré-remplie par {PLAN.name} ({len(plan)} lignes) : vérifie, dans le rapport, que chaque ligne lue correspond à la ligne prévue.", flush=True)
        else:
            print(f"⚠ {PLAN.name} prévoit {len(plan)} lignes mais {len(candidats)} groupes ont été lus : référence NON pré-remplie (regroupement à vérifier).", flush=True)
    REFERENCE.write_text(json.dumps({
        "feuille": FEUILLE.name,
        "consigne": "Pour chaque groupe, remplis « erreur » avec une description courte de la faute de l'élève ; laisse vide si la ligne est juste. "
                    "Les groupes de texte et les figures sont des lignes « justes » (vides) sauf si tu veux qu'on les signale.",
        "groupes": [{"id": g.id, "type_probable": g.type_probable, "latex": g.latex if g.statut == "ok" else None,
                     "corrige_en_bleu": toucher_bleu(g, bleus, 1.0 * h), "ligne_prevue": appar.get(g.id, {}).get("ligne", ancien.get(g.id, {}).get("ligne_prevue", "")),
                     "erreur": ancien.get(g.id, {}).get("erreur", appar.get(g.id, {}).get("erreur", ""))} for g in groupes],
    }, ensure_ascii=False, indent=2), encoding="utf-8")


def lire_reference() -> dict[str, dict]:
    return {g["id"]: g for g in json.loads(REFERENCE.read_text(encoding="utf-8"))["groupes"]}


# --- Essais -----------------------------------------------------------------------------------------------------
def preparer_images(groupes, traits, h, noms=None) -> dict[str, dict]:
    """Images envoyées pour chaque configuration qui en utilise (rendues une fois)."""
    out = {}
    for nom, c in CONFIGS.items():
        if c["bandes"] <= 0 or (noms is not None and nom not in noms):
            continue
        t = time.perf_counter()
        chemins = rendre_page(traits, groupes, h, SORTIE / "images", nom, c["bandes"])
        out[nom] = {"chemins": chemins, "rendu_s": round(time.perf_counter() - t, 2)}
    return out


def lancer(args) -> dict:
    cfg = Config.charger(None)
    SORTIE.mkdir(parents=True, exist_ok=True)
    if not LOT1.exists():
        ancien = SORTIE / "runs.json"
        if NOM == "feuille_2" and ancien.exists():  # 1er lot de la première version de ce script
            ancien.replace(LOT1)
        else:
            figer_lecture(cfg)
    groupes, traits, h, lecture_s = groupes_figes(cfg)
    complete = charger_feuille(FEUILLE)
    ajouts = [n.strip() for n in (args.ajouter or "").split(",") if n.strip()]
    existant = json.loads((SORTIE / "runs.json").read_text(encoding="utf-8")) if ajouts else None
    for n in ajouts:
        if n not in CONFIGS:
            raise SystemExit(f"configuration inconnue : {n} (connues : {', '.join(CONFIGS)})")
        if existant and n in existant["mapping"].values():
            raise SystemExit(f"{n} est déjà dans runs.json")
    if not ajouts:  # en mode « ajouter », la référence est en cours d'édition par l'utilisateur : on n'y touche pas
        ecrire_reference(groupes, complete, h)
    noms = ajouts or list(CONFIGS)
    images = preparer_images(groupes, traits, h, noms)
    print(f"Lecture figée : {len(groupes)} groupes ; lecture TexTeller de référence {lecture_s:.0f} s ; images : "
          + ", ".join(f"{n} ({len(v['chemins'])} fichier(s))" for n, v in images.items()), flush=True)
    if args.apercu_images:
        return {}

    ordre = [(rep, mode, nom) for rep in range(1, args.executions + 1) for mode in MODES for nom in noms]
    alea = random.Random(datetime.now().timestamp())
    alea.shuffle(ordre)  # ordre mélangé : pas d'effet de dérive (heure, charge)
    if existant:  # les étiquettes déjà attribuées ne changent pas (l'utilisateur est peut-être en train de noter) : les nouvelles prennent les lettres suivantes
        mapping = dict(existant["mapping"])
        for nom in ajouts:
            mapping[next(l for l in ETIQUETTES if l not in mapping)] = nom
    else:
        etiquettes = list(ETIQUETTES[: len(CONFIGS)])
        alea.shuffle(etiquettes)
        mapping = dict(zip(etiquettes, CONFIGS))  # étiquette aveugle → configuration

    runs = existant["runs"] if existant else []
    for k, (rep, mode, nom) in enumerate(ordre, 1):
        conf = CONFIGS[nom]
        c = copy.copy(cfg.correction)
        c.effort = conf["effort"]
        print(f"[{k}/{len(ordre)}] {nom} / {mode} / exécution {rep}…", end=" ", flush=True)
        t = time.perf_counter()
        r = {"config": nom, "mode": mode, "execution": rep}
        try:
            res = corriger(c, groupes, mode=mode, images=images[nom]["chemins"] if nom in images else None, entree=conf["entree"])
            m = res["meta"]
            verif = [v for v in m.get("verification", []) if "groupe" in v]
            ocr = conf["entree"] in ("ocr", "ocr_image")
            r.update(
                annotations=res["annotations"],
                duree_s=m["duree_s"], duree_passe1_s=m.get("duree_passe1_s"), duree_verification_s=m.get("duree_verification_s", 0),
                tokens_entree=sum(x.get("tokens_entree") or 0 for x in m["tentatives"]) + sum(v.get("tokens_entree") or 0 for v in verif),
                tokens_sortie=sum(x.get("tokens_sortie") or 0 for x in m["tentatives"]) + sum(v.get("tokens_sortie") or 0 for v in verif),
                rendu_image_s=images[nom]["rendu_s"] if nom in images else 0,
                e2e_s=round(m["duree_s"] + (lecture_s if ocr else 0) + (images[nom]["rendu_s"] if nom in images else 0), 2),
                verifications=[{"groupe": v["groupe"], "verdict": v.get("verdict")} for v in verif],
            )
            print(f"{m['duree_s']} s, {len(res['annotations'])} annotations, {r['tokens_entree']} tok. entrée / {r['tokens_sortie']} sortie", flush=True)
        except ErreurCorrection as e:
            r["erreur"] = str(e)
            print(f"ERREUR : {e}", flush=True)
        r["mur_s"] = round(time.perf_counter() - t, 2)
        runs.append(r)

    donnees = {
        "date": existant["date"] if existant else datetime.now().isoformat(timespec="seconds"),  # clé des notes de l'utilisateur : inchangée à l'ajout
        "modele": cfg.correction.modele, "ignorer": IGNORER, "executions": args.executions,
        "mapping": mapping, "configs": {n: {k: v for k, v in c.items()} for n, c in CONFIGS.items()}, "lecture_ocr_s": lecture_s,
        "images": {**(existant["images"] if existant else {}), **{n: [p.name for p in v["chemins"]] for n, v in images.items()}},
        "groupes": [{"id": g.id, "x0": g.x0, "y0": g.y0, "x1": g.x1, "y1": g.y1, "latex": g.latex, "type": g.type_probable, "statut": g.statut} for g in groupes],
        "h": h, "runs": runs,
        "ajouts": (existant.get("ajouts", []) if existant else []) + ([{"date": datetime.now().isoformat(timespec="seconds"), "configs": ajouts}] if ajouts else []),
    }
    (SORTIE / "runs.json").write_text(json.dumps(donnees, ensure_ascii=False, indent=2), encoding="utf-8")
    return donnees


# --- Mesures ----------------------------------------------------------------------------------------------------
def mesures(donnees: dict, ref: dict[str, dict]) -> dict[tuple[str, str], dict]:
    """Moyennes par (configuration, mode) sur les exécutions réussies."""
    vraies = {g for g, r in ref.items() if (r.get("erreur") or "").strip()}
    justes = set(ref) - vraies
    out = {}
    for nom in CONFIGS:
        for mode in MODES:
            rs = [r for r in donnees["runs"] if r["config"] == nom and r["mode"] == mode and "annotations" in r]
            if not rs:
                continue
            trouvees, fausses, douteuses = [], [], []
            for r in rs:
                sig = {a["groupe"] for a in r["annotations"] if a["type"] in SIGNALE}
                trouvees.append(len(sig & vraies))
                fausses.append(len(sig & justes))
                douteuses.append(sum(a["type"] == "lecture_douteuse" for a in r["annotations"]))
            out[(nom, mode)] = {
                "n": len(rs), "vraies": len(vraies), "rappel": (st.mean(trouvees) / len(vraies)) if vraies else None,
                "trouvees": st.mean(trouvees), "fausses": st.mean(fausses), "douteuses": st.mean(douteuses),
                "claude_s": st.mean(r["duree_s"] for r in rs), "e2e_s": st.mean(r["e2e_s"] for r in rs),
                "verif_s": st.mean(r["duree_verification_s"] for r in rs), "e2e_sans_verif_s": st.mean(r["e2e_s"] - r["duree_verification_s"] for r in rs),
                "verifs": st.mean(len(r["verifications"]) for r in rs),
                "verifs_ecartees": st.mean(sum(v["verdict"] != "confirmee" for v in r["verifications"]) for r in rs),
                "tok_in": st.mean(r["tokens_entree"] for r in rs), "tok_out": st.mean(r["tokens_sortie"] for r in rs),
            }
    return out


# --- Rapport ----------------------------------------------------------------------------------------------------
CSS = """body{font:14px system-ui,sans-serif;max-width:1750px;margin:20px auto;padding:0 14px;color:#222}h1{font-size:21px}h2{font-size:16px;border-bottom:1px solid #ddd;padding-bottom:4px;margin-top:28px}
table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #ddd;padding:5px 10px;text-align:left}th{background:#f6f6f6}.dim{color:#777;font-size:12px}td.n{text-align:right}
.g{border:1px solid #ddd;border-radius:10px;padding:10px 14px;margin:14px 0}.g img{max-width:100%;border:1px solid #eee}.tete{display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap}
.grille{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px}.mode h4{margin:10px 0 2px;font-size:13px;color:#555}
.ann{border-left:4px solid #bbb;padding:3px 8px;margin:3px 0;background:#fafafa;border-radius:0 6px 6px 0}
.badge{display:inline-block;padding:0 8px;border-radius:9px;color:#fff;font-size:11px;margin-right:6px}.run{color:#999;font-size:11px;margin-right:4px}
.note{white-space:pre-wrap}.q{margin-left:8px;white-space:nowrap}.q button{border:1px solid #ccc;background:#fff;border-radius:5px;padding:0 7px;cursor:pointer;font-size:12px}.q button.sel{background:#1a56db;color:#fff;border-color:#1a56db}
.erreur-ref{background:#fef3f2;border:1px solid #fda29b;padding:3px 8px;border-radius:6px}.bleu{background:#e8efff;color:#1a56db;padding:0 8px;border-radius:9px;font-size:12px}
.cache-aveugle{display:none}.revele .cache-aveugle{display:inline}button.gros{padding:8px 16px;font-size:14px;margin:6px 6px 6px 0;cursor:pointer}.pages img{max-height:760px;margin-right:10px}"""

JS = """
const D = __DATA__;
const KEY = 'effort_notes_' + D.date;
let notes = {};
try { notes = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
function sauve() { try { localStorage.setItem(KEY, JSON.stringify(notes)); } catch (e) {} }
function maj() {
  document.querySelectorAll('.q').forEach(q => { const v = notes[q.dataset.cle]; q.querySelectorAll('button').forEach(b => b.classList.toggle('sel', Number(b.dataset.v) === v)); });
  for (const lab of D.etiquettes) for (const mode of D.modes) {
    const vals = Object.entries(notes).filter(([k]) => k.startsWith(mode + '|' + lab + '|')).map(([, v]) => v);
    const cell = document.getElementById('note-' + mode + '-' + lab);
    if (cell) cell.textContent = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) + ' (' + vals.length + ')' : '–';
  }
}
document.addEventListener('click', e => {
  const b = e.target.closest('.q button');
  if (b) { const c = b.parentElement.dataset.cle; if (notes[c] === Number(b.dataset.v)) delete notes[c]; else notes[c] = Number(b.dataset.v); sauve(); maj(); }
});
document.getElementById('reveler').addEventListener('click', () => document.body.classList.add('revele'));
document.getElementById('exporter').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ exporte_le: new Date().toISOString(), mapping: D.mapping, notes }, null, 2)], { type: 'application/json' });
  Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'notes_effort.json' }).click();
});
maj();
"""


def rapport(donnees: dict, ref: dict[str, dict]) -> Path:
    complete = charger_feuille(FEUILLE)
    h = donnees["h"]
    inv = {v: k for k, v in donnees["mapping"].items()}
    etiquettes = sorted(donnees["mapping"])
    mes = mesures(donnees, ref)
    vraies = [g for g, r in ref.items() if (r.get("erreur") or "").strip()]

    w = ["<!doctype html><meta charset=utf-8><title>Comparaison des configurations</title>",
         '<link rel=stylesheet href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">', f"<style>{CSS}</style>",
         f"<h1>Comparaison des façons de corriger — {html.escape(NOM)}" + (" (bleu exclu)" if IGNORER else "") + "</h1>",
         f'<p class=dim>{html.escape(donnees["date"])} · modèle {html.escape(donnees["modele"])} · {donnees["executions"]} exécutions par combinaison · lecture TexTeller figée '
         f'(identique pour tous les essais) · {len(etiquettes)} configurations en aveugle : {", ".join(etiquettes)}.</p>',
         '<button class=gros id=reveler>Révéler les configurations</button><button class=gros id=exporter>Exporter mes notes (JSON)</button>',
         '<div class=cache-aveugle><ul>' + "".join(f"<li><b>{lab}</b> = {html.escape(CONFIGS[donnees['mapping'][lab]]['titre'])}</li>" for lab in etiquettes) + "</ul></div>"]
    if vraies:
        w.append(f"<p>Référence : <b>{len(vraies)}</b> ligne(s) avec une vraie faute ({', '.join(vraies)}).</p>")
    else:
        w.append("<p class=erreur-ref>Référence sans faute : la feuille est considérée entièrement juste. Toute ligne annotée « erreur » (ou « indice ») est donc une <b>fausse alerte</b> ; "
                 "le <b>rappel n'est pas mesurable</b> sur cette feuille. Si une ligne contient en réalité une faute, décris-la dans le champ « erreur » de "
                 f"<code>reference_{NOM}.json</code> et relance avec <code>--rapport</code>.</p>")
    w.append("<h2>Récapitulatif</h2><table><tr><th>Mode</th><th>Config</th><th>Rappel</th><th>Erreurs trouvées</th><th>Fausses alertes</th><th>Lectures douteuses</th>"
             "<th>Tokens d'entrée</th><th>Tokens de sortie</th><th>Temps Claude (s)</th><th>dont vérification (s)</th>"
             "<th>2e passe : lancées / écartées</th><th>Bout en bout (s)</th><th>Bout en bout sans vérification (s)</th><th>Ma note moyenne</th></tr>")
    for mode in MODES:
        for lab in etiquettes:
            nom = donnees["mapping"][lab]
            m = mes.get((nom, mode))
            if not m:
                continue
            rap = "–" if m["rappel"] is None else f"{100 * m['rappel']:.0f} %"
            w.append(f"<tr><td>{LIBELLE_MODE[mode]}</td><td><b>{lab}</b><span class=cache-aveugle> = {html.escape(CONFIGS[nom]['titre'])}</span></td><td class=n>{rap}</td>"
                     f"<td class=n>{m['trouvees']:.1f} / {m['vraies']}</td><td class=n>{m['fausses']:.1f}</td><td class=n>{m['douteuses']:.1f}</td>"
                     f"<td class=n>{m['tok_in']:.0f}</td><td class=n>{m['tok_out']:.0f}</td><td class=n>{m['claude_s']:.1f}</td><td class=n>{m['verif_s']:.1f}</td>"
                     f"<td class=n>{m['verifs']:.1f} / {m['verifs_ecartees']:.1f}</td><td class=n>{m['e2e_s']:.1f}</td><td class=n>{m['e2e_sans_verif_s']:.1f}</td>"
                     f'<td id="note-{mode}-{lab}" class=n>–</td></tr>')
    w.append(f"</table><p class=dim>« Signalée » = ligne annotée « erreur » (ou « indice » dans le mode un indice seulement). Moyennes sur les exécutions réussies. "
             f"Tokens d'entrée = entrée totale (cache de prompt compris), 1re passe + vérifications. « 2e passe » = vérification d'une erreur sur l'image de son groupe : lancées = erreurs vérifiées par exécution, écartées = celles que la vérification a infirmées (devenues lecture douteuse ou supprimées). Temps bout en bout = appels à Claude (1re passe + vérifications) "
             f"+ rendu des images + lecture TexTeller froide ({donnees['lecture_ocr_s']:.0f} s, comptée seulement pour les configurations OCR ; avec le cache et la lecture de fond, elle tombe à ~0).</p>")

    # Pages envoyées
    w.append("<h2>Images envoyées à Claude</h2><p class=dim>Ce que voient les configurations « image » : traits noirs, cadre magenta numéroté autour de chaque groupe (le bleu de l'élève est exclu).</p>")
    for nom in ("image_page", "image_bandes"):
        fichiers = donnees.get("images", {}).get(nom, [])
        if fichiers:
            w.append(f'<div class="pages cache-aveugle"><b>{html.escape(CONFIGS[nom]["titre"])}</b><br></div><div class=pages>'
                     + "".join(f'<img src="{b64(__import__("PIL.Image", fromlist=["Image"]).open(SORTIE / "images" / f))}" title="{html.escape(f)}">' for f in fichiers) + "</div>")

    w.append("<h2>Par groupe</h2><p class=dim>Cliquez 1 / 2 / 3 sous chaque annotation (1 = faux ou inutile, 2 = correct sans plus, 3 = très bon). Vos notes sont gardées dans ce navigateur.</p>")
    for g in donnees["groupes"]:
        gid = g["id"]
        anns = [(r, a) for r in donnees["runs"] if "annotations" in r for a in r["annotations"] if a.get("groupe") == gid]
        r_ref = ref.get(gid, {})
        if g["type"] == "regle" or (g["latex"] is None and not anns):
            continue
        marge = 1.2 * h
        img = dessiner(complete.traits, (g["x0"] - marge, g["y0"] - marge, g["x1"] + marge, g["y1"] + marge), 2.0)
        w.append(f'<div class=g><div class=tete><div><b>{gid}</b> <span class=dim>{html.escape(g["type"])}</span>'
                 + (' <span class=bleu>corrigé en bleu</span>' if r_ref.get("corrige_en_bleu") else "") + f'<br><img src="{b64(img)}"></div><div>')
        if g["latex"]:
            w.append(f'<span class="kx" data-latex="{html.escape(g["latex"], quote=True)}"></span><br><code class=dim>{html.escape(g["latex"])}</code>')
        if (r_ref.get("erreur") or "").strip():
            w.append(f'<p class=erreur-ref><b>Ma faute :</b> {html.escape(r_ref["erreur"])}</p>')
        w.append("</div></div>")
        for mode in MODES:
            w.append(f'<div class=mode><h4>{LIBELLE_MODE[mode]}</h4><div class=grille>')
            for lab in etiquettes:
                nom = donnees["mapping"][lab]
                w.append(f"<div><b>{lab}</b><span class=cache-aveugle> ({html.escape(CONFIGS[nom]['titre'])})</span>")
                lignes = [(r, a) for r, a in anns if r["config"] == nom and r["mode"] == mode]
                if not lignes:
                    w.append('<div class=dim>aucune annotation</div>')
                for i, (r, a) in enumerate(lignes):
                    c = COULEURS.get(a["type"], "#555")
                    corps = ""
                    if a.get("extrait"):
                        corps += f' <span class="kx" data-latex="{html.escape(a["extrait"], quote=True)}"></span>'
                    if a.get("lu"):
                        corps += (f' lu <span class="kx" data-latex="{html.escape(a["lu"], quote=True)}"></span> → '
                                  f'<span class="kx" data-latex="{html.escape(a.get("propose", ""), quote=True)}"></span> ?')
                    if a.get("note"):
                        corps += f' <span class="note">{html.escape(a["note"])}</span>'
                    cle = f"{mode}|{lab}|r{r['execution']}|{gid}|{i}"
                    q = (f'<span class=q data-cle="{html.escape(cle)}"><button data-v=1>1</button><button data-v=2>2</button><button data-v=3>3</button></span>' if a["type"] != "ok" else "")
                    w.append(f'<div class=ann style="border-color:{c}"><span class=run>#{r["execution"]}</span><span class=badge style="background:{c}">{a["type"].replace("_", " ")}</span>{corps}{q}</div>')
                w.append("</div>")
            w.append("</div></div>")
        w.append("</div>")
    gen = [x for x in donnees["runs"] if "erreur" in x]
    if gen:
        w.append("<h2>Exécutions en échec</h2><ul>" + "".join(f"<li>{x['config']} / {x['mode']} #{x['execution']} : {html.escape(x['erreur'])}</li>" for x in gen) + "</ul>")
    w.append('<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>'
             '<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>'
             "<script>document.querySelectorAll('.kx').forEach(function(el){try{katex.render(el.dataset.latex,el,{throwOnError:false})}catch(e){el.textContent=el.dataset.latex}});"
             "document.querySelectorAll('.note').forEach(function(el){renderMathInElement(el,{delimiters:[{left:'$',right:'$',display:false}],throwOnError:false})});</script>")
    w.append("<script>" + JS.replace("__DATA__", json.dumps({"mapping": donnees["mapping"], "modes": MODES, "date": donnees["date"], "etiquettes": etiquettes})) + "</script>")
    chemin = SORTIE / "rapport.html"
    chemin.write_text("\n".join(w), encoding="utf-8")
    return chemin


def synthese(donnees: dict, ref: dict[str, dict], notes: dict, etiquettes_notes: dict) -> str:
    """Synthèse en clair (après révélation) : rappel, fausses alertes, qualité jugée, coûts, détection faute par faute."""
    inv = {v: k for k, v in donnees["mapping"].items()}
    if etiquettes_notes != donnees["mapping"]:
        raise SystemExit("Le mapping A/B/C… du fichier de notes ne correspond pas à runs.json : ce ne sont pas les notes de cette feuille.")
    mes = mesures(donnees, ref)
    vraies = sorted((g for g, r in ref.items() if (r.get("erreur") or "").strip()), key=lambda g: int(g[1:]))
    justes = [g for g in ref if g not in vraies]

    # note de chaque annotation, retrouvée par la même clé que dans le rapport
    detail: dict[tuple[str, str], list[tuple[str, int]]] = {}  # (config, mode) → [(type, note)]
    for nom in CONFIGS:
        for mode in MODES:
            lab = inv.get(nom)
            if lab is None:
                continue
            compte: dict[str, int] = {}
            for r in (x for x in donnees["runs"] if x["config"] == nom and x["mode"] == mode and "annotations" in x):
                for a in r["annotations"]:
                    gid = a.get("groupe")
                    if gid is None:
                        continue
                    i = compte.get(gid, 0)
                    compte[gid] = i + 1
                    if a["type"] != "ok":
                        v = notes.get(f"{mode}|{lab}|r{r['execution']}|{gid}|{i}")
                        if v is not None:
                            detail.setdefault((nom, mode), []).append((a["type"], v))

    L = [f"# Synthèse — {NOM}", "",
         f"Référence : {len(vraies)} lignes avec faute ({', '.join(vraies)}), {len(justes)} lignes justes. {donnees['executions']} exécutions par combinaison.", ""]
    for mode in MODES:
        L += [f"## {LIBELLE_MODE[mode]}", "",
              "| Config | Rappel | Fautes trouvées | Fausses alertes | Lect. douteuses | Note moy. (n) | Note erreur / indice | Note lect. douteuse | Tokens entrée | Tokens sortie | Claude s | dont vérif. s | Bout en bout s | sans vérif. s |",
              "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
        for nom, c in CONFIGS.items():
            m = mes.get((nom, mode))
            if not m:
                continue
            d = detail.get((nom, mode), [])
            moy = lambda xs: f"{st.mean(xs):.2f}" if xs else "–"
            tout = [v for _, v in d]
            err = [v for t, v in d if t in SIGNALE]
            dou = [v for t, v in d if t == "lecture_douteuse"]
            rap = "–" if m["rappel"] is None else f"{100 * m['rappel']:.0f} %"
            L.append(f"| {c['titre']} ({inv[nom]}) | {rap} | {m['trouvees']:.1f}/{m['vraies']} | {m['fausses']:.1f} | {m['douteuses']:.1f} | {moy(tout)} ({len(tout)}) | {moy(err)} | {moy(dou)} | "
                     f"{m['tok_in']:.0f} | {m['tok_out']:.0f} | {m['claude_s']:.1f} | {m['verif_s']:.1f} | {m['e2e_s']:.1f} | {m['e2e_sans_verif_s']:.1f} |")
        L.append("")
    # faute par faute : sur 3 exécutions, combien de fois chaque faute est signalée
    L += ["## Détection faute par faute (signalée dans combien d'exécutions sur " + str(donnees["executions"]) + ")", ""]
    for mode in MODES:
        L += [f"**{LIBELLE_MODE[mode]}**", "", "| Config | " + " | ".join(vraies) + " | fausses alertes (ligne : nb) |", "|---|" + "---|" * (len(vraies) + 1)]
        for nom, c in CONFIGS.items():
            rs = [r for r in donnees["runs"] if r["config"] == nom and r["mode"] == mode and "annotations" in r]
            if not rs:
                continue
            cel = []
            for g in vraies:
                cel.append(str(sum(any(a.get("groupe") == g and a["type"] in SIGNALE for a in r["annotations"]) for r in rs)))
            fa = {}
            for r in rs:
                for g in {a["groupe"] for a in r["annotations"] if a["type"] in SIGNALE and a.get("groupe") in justes}:
                    fa[g] = fa.get(g, 0) + 1
            L.append(f"| {c['titre']} | " + " | ".join(cel) + " | " + (", ".join(f"{g} : {n}" for g, n in sorted(fa.items(), key=lambda x: int(x[0][1:]))) or "–") + " |")
        L.append("")
    return "\n".join(L)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--feuille", default="feuille_2", help="nom de la feuille à la racine du projet, sans .json (défaut : feuille_2)")
    ap.add_argument("--ignorer", default=None, help="couleurs à ignorer, séparées par des virgules (défaut : #1a56db pour feuille_2, aucune pour les autres)")
    ap.add_argument("--executions", type=int, default=3)
    ap.add_argument("--rapport", action="store_true", help="refait le rapport depuis runs.json et la référence actuelle, sans relancer Claude")
    ap.add_argument("--ajouter", help="noms de configurations à ajouter à runs.json (étiquettes existantes inchangées ; référence non touchée), ex. image_page_low")
    ap.add_argument("--synthese", metavar="NOTES.json", help="notes exportées du rapport : écrit synthese.md (configurations révélées, rappel, fausses alertes, notes, coûts)")
    ap.add_argument("--apercu-images", action="store_true", help="écrit seulement les images envoyées (aucun appel à Claude)")
    args = ap.parse_args()
    ignorer = args.ignorer if args.ignorer is not None else ("#1a56db" if args.feuille == "feuille_2" else "")
    configurer(args.feuille, [c.strip() for c in ignorer.split(",") if c.strip()])
    if args.synthese:
        donnees = json.loads((SORTIE / "runs.json").read_text(encoding="utf-8"))
        brut = json.loads(Path(args.synthese).read_text(encoding="utf-8"))
        texte = synthese(donnees, lire_reference(), brut["notes"], brut["mapping"])
        (SORTIE / "synthese.md").write_text(texte, encoding="utf-8")
        (SORTIE / "notes_effort.json").write_text(json.dumps(brut, ensure_ascii=False, indent=2), encoding="utf-8")
        print(texte)
        return 0
    if args.rapport:
        donnees = json.loads((SORTIE / "runs.json").read_text(encoding="utf-8"))
    else:
        donnees = lancer(args)
        if args.apercu_images:
            print(f"Images : {SORTIE / 'images'}")
            return 0
    print(f"Rapport : {rapport(donnees, lire_reference())}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
