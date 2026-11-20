"""Essai de la correction sur une feuille JSON, hors app, avec rapport de comparaison.

    bench-reco\.venv\Scripts\python bench-reco\essai_correction.py ..\feuille_2.json --ignorer "#1a56db"

Les traits des couleurs ignorées sont retirés avant lecture et correction (Claude ne les voit pas) mais restent
dessinés dans le rapport, pour comparer les annotations de Claude à ce qui a été corrigé à la main.
Sortie : sorties/correction_<feuille>/rapport.html (+ annotations.json). Journal de l'appel : logs/.
"""
from __future__ import annotations

import argparse
import base64
import html
import io
import json
import sys
import time
from pathlib import Path

from PIL import Image, ImageDraw

from benchreco.config import Config
from benchreco.feuille import charger_feuille
from correction import ErreurCorrection, corriger
from pipeline import Lecteur

ICI = Path(__file__).resolve().parent
COULEURS = {"ok": (22, 163, 74), "erreur": (220, 38, 38), "indice": (217, 119, 6), "lecture_douteuse": (147, 51, 234)}
LIBELLES = {"ok": "ok", "erreur": "erreur", "indice": "indice", "lecture_douteuse": "lecture douteuse", "remarque_generale": "remarque générale"}


def _hex(c: str) -> tuple[int, int, int]:
    c = c.lstrip("#")
    return tuple(int(c[i : i + 2], 16) for i in (0, 2, 4)) if len(c) == 6 else (0, 0, 0)


def dessiner(traits, zone, echelle, boites=(), gris_noir=True) -> Image.Image:
    """Traits d'origine (couleurs conservées, noir adouci) dans la zone (x0, y0, x1, y1) ; boites = [(bbox, couleur, étiquette)]."""
    x0, y0, x1, y1 = zone
    img = Image.new("RGB", (max(1, round((x1 - x0) * echelle)), max(1, round((y1 - y0) * echelle))), "white")
    d = ImageDraw.Draw(img)
    for t in traits:
        if t.x1 < x0 or t.x0 > x1 or t.y1 < y0 or t.y0 > y1:
            continue
        c = _hex(t.couleur)
        if gris_noir and sum(c) < 120:
            c = (70, 70, 70)
        pts = [((x - x0) * echelle, (y - y0) * echelle) for x, y in t.pts]
        if len(pts) > 1:
            d.line(pts, fill=c, width=2, joint="curve")
        else:
            d.ellipse([pts[0][0] - 1.5, pts[0][1] - 1.5, pts[0][0] + 1.5, pts[0][1] + 1.5], fill=c)
    for (bx0, by0, bx1, by1), c, etiquette in boites:
        r = [(bx0 - x0) * echelle, (by0 - y0) * echelle, (bx1 - x0) * echelle, (by1 - y0) * echelle]
        d.rectangle(r, outline=c, width=2)
        d.text((r[0] + 2, r[1] - 12), etiquette, fill=c)
    return img


def b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("feuille")
    ap.add_argument("--ignorer", default="", help="couleurs à ignorer, séparées par des virgules (ex. #1a56db)")
    ap.add_argument("--mode", help="tout | sans_solution | indice | resultat_final (défaut : config.toml)")
    ap.add_argument("--ton", help="bref | detaille")
    ap.add_argument("--enonce", help="énoncé (texte libre)")
    ap.add_argument("--sortie", help="dossier de sortie")
    args = ap.parse_args()

    cfg = Config.charger(None)
    ignorer = [c.strip() for c in args.ignorer.split(",") if c.strip()] or list(cfg.correction.ignorer_couleurs)
    brut = json.loads(Path(args.feuille).read_text(encoding="utf-8"))
    complete = charger_feuille(args.feuille)  # toutes les couleurs, pour le rapport

    print("Chargement de TexTeller…", flush=True)
    lecteur = Lecteur(cfg)
    lecteur.charger()
    t0 = time.perf_counter()
    feuille, h, groupes = lecteur.lire(brut, ignorer)
    print(f"{len(feuille.traits)} traits vus par Claude ({len(complete.traits) - len(feuille.traits)} ignorés : {ignorer or 'aucune couleur'}), "
          f"{len(groupes)} groupes, lus en {time.perf_counter() - t0:.1f} s", flush=True)

    erreur = None
    res = {"annotations": [], "meta": {}}
    try:
        print(f"Appel de Claude (backend {cfg.correction.backend}, {cfg.correction.modele})…", flush=True)
        res = corriger(cfg.correction, groupes, args.enonce, args.mode, args.ton)
        m = res["meta"]
        print(f"→ {len(res['annotations'])} annotations en {m['duree_s']} s ; " + "; ".join(
            f"tentative {t['tentative']} : {t['duree_s']} s, {t['taille_requete_octets']} octets, ${t.get('cout_usd')}" for t in m["tentatives"]), flush=True)
    except ErreurCorrection as e:
        erreur = str(e)
        print(f"Correction impossible : {e}", file=sys.stderr)

    nom = Path(args.feuille).stem
    sortie = Path(args.sortie) if args.sortie else ICI / "sorties" / f"correction_{nom}"
    sortie.mkdir(parents=True, exist_ok=True)
    (sortie / "annotations.json").write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")

    par_groupe: dict[str, list[dict]] = {}
    generales = []
    for a in res["annotations"]:
        (generales if a["type"] == "remarque_generale" else par_groupe.setdefault(a["groupe"], [])).append(a)

    # Vue d'ensemble : tous les traits (bleu compris), groupes encadrés selon l'annotation de Claude.
    marge = 2 * h
    zone = (min(t.x0 for t in complete.traits) - marge, min(t.y0 for t in complete.traits) - marge,
            max(t.x1 for t in complete.traits) + marge, max(t.y1 for t in complete.traits) + marge)
    boites = []
    for g in groupes:
        anns = par_groupe.get(g.id)
        c = COULEURS.get(anns[0]["type"], (150, 150, 150)) if anns else (190, 190, 190)
        boites.append(((g.x0 - 0.3 * h, g.y0 - 0.3 * h, g.x1 + 0.3 * h, g.y1 + 0.3 * h), c, g.id))
    vue = dessiner(complete.traits, zone, 1100 / (zone[2] - zone[0]), boites)

    w = []
    w.append("<!doctype html><meta charset=utf-8><title>Correction — essai</title>")
    w.append('<link rel=stylesheet href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">')
    w.append("""<style>body{font:14px system-ui,sans-serif;max-width:1150px;margin:20px auto;padding:0 12px;color:#222}
h1{font-size:20px}h2{font-size:16px;border-bottom:1px solid #ddd;padding-bottom:4px}
.g{border:1px solid #ddd;border-radius:8px;padding:8px 12px;margin:10px 0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px 16px}
.g img{max-width:100%;border:1px solid #eee}.dim{color:#777;font-size:12px}
.tag{display:inline-block;padding:1px 8px;border-radius:10px;color:#fff;font-size:12px;margin-right:6px}
.erreur-box{background:#fef3f2;border:1px solid #fda29b;padding:8px 12px;border-radius:8px}code{font-size:12px}</style>""")
    w.append(f"<h1>Correction de {html.escape(nom)}</h1>")
    m = res.get("meta", {})
    w.append(f'<p class=dim>backend {html.escape(str(m.get("backend", cfg.correction.backend)))} · modèle {html.escape(cfg.correction.modele)} · '
             f'mode {html.escape(str(m.get("mode", "?")))} · couleurs ignorées : {html.escape(", ".join(ignorer) or "aucune")} · '
             f'durée Claude {m.get("duree_s", "?")} s (1re passe {m.get("duree_passe1_s", "?")} s, vérification {m.get("duree_verification_s", 0)} s)</p>')
    if erreur:
        w.append(f'<p class=erreur-box>Correction impossible : {html.escape(erreur)}</p>')
    w.append("<h2>Vue d'ensemble</h2><p class=dim>Noir = ce que Claude voit · bleu (ou autre couleur ignorée) = invisible pour Claude. "
             "Cadre vert = ok, rouge = erreur, orange = indice, violet = lecture douteuse, gris = pas d'annotation.</p>")
    w.append(f'<img src="{b64(vue)}" style="max-width:100%">')
    if generales:
        w.append("<h2>Remarques générales</h2>")
        for a in generales:
            w.append(f'<p><span class=note>{html.escape(a["note"])}</span></p>')
    verifs = [v for v in res.get("meta", {}).get("verification", []) if "groupe" in v]
    if verifs:
        w.append("<h2>Vérification sur l'image (2e passe)</h2>")
        w.append('<p class=dim>Chaque « erreur » de la 1re passe est revérifiée par Claude sur l’image du groupe : confirmée, lecture fausse (devient lecture douteuse) ou ligne juste (disparaît).</p>')
        for v in verifs:
            avant, apres = v.get("avant", {}), v.get("apres")
            devenir = "disparaît" if not apres else f"devient {LIBELLES[apres['type']]}" if apres["type"] != avant.get("type") else ("gardée" + (" (relue)" if apres.get("verifiee") else " (non relue)"))
            w.append(f'<div class=g><div><b>{v["groupe"]}</b> · verdict : <b>{html.escape(v.get("verdict", "?"))}</b> → {devenir}'
                     f' <span class=dim>({v.get("duree_s", "?")} s)</span><br>')
            if v.get("erreur"):
                w.append(f'<span class=erreur-box>{html.escape(v["erreur"])}</span>')
            if v.get("lecture_image"):
                w.append(f'lecture sur l’image : <span class="katex-view" data-latex="{html.escape(v["lecture_image"], quote=True)}"></span><br>')
            if v.get("explication"):
                w.append(f'<span class=dim>{html.escape(v["explication"])}</span>')
            w.append(f'</div><div>avant : <span class=note>{html.escape(avant.get("note", ""))}</span> '
                     f'<code>{html.escape(avant.get("extrait", ""))}</code></div></div>')
    w.append("<h2>Détail par groupe</h2>")
    for g in groupes:
        anns = par_groupe.get(g.id, [])
        marge_g = 1.2 * h
        crop = dessiner(complete.traits, (g.x0 - marge_g, g.y0 - marge_g, g.x1 + marge_g, g.y1 + marge_g), 2.0)
        w.append(f"<div class=g><div><b>{g.id}</b> <span class=dim>{html.escape(g.type_probable)} · couleur {html.escape(g.couleur)}</span><br>"
                 f'<img src="{b64(crop)}"><br>')
        if g.latex:
            w.append(f'<span class="katex-view" data-latex="{html.escape(g.latex, quote=True)}"></span><br><code>{html.escape(g.latex)}</code>')
        w.append("</div><div>")
        if not anns:
            w.append("<span class=dim>pas d'annotation</span>")
        for a in anns:
            c = COULEURS[a["type"]]
            w.append(f'<p><span class=tag style="background:rgb{c}">{LIBELLES[a["type"]]}</span>')
            if a.get("extrait"):
                w.append(f'extrait : <span class="katex-view" data-latex="{html.escape(a["extrait"], quote=True)}"></span> ')
            if a.get("lu"):
                w.append(f'lu <span class="katex-view" data-latex="{html.escape(a["lu"], quote=True)}"></span> → '
                         f'<span class="katex-view" data-latex="{html.escape(a["propose"], quote=True)}"></span> ')
            if a.get("note"):
                w.append(f'<span class=note>{html.escape(a["note"])}</span>')
            w.append("</p>")
        w.append("</div></div>")
    w.append("""<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
<script>
document.querySelectorAll('.katex-view').forEach(function(el){try{katex.render(el.dataset.latex,el,{throwOnError:false})}catch(e){el.textContent=el.dataset.latex}});
document.querySelectorAll('.note').forEach(function(el){renderMathInElement(el,{delimiters:[{left:'$',right:'$',display:false}],throwOnError:false})});
</script>""")
    (sortie / "rapport.html").write_text("\n".join(w), encoding="utf-8")
    print(f"Rapport : {sortie / 'rapport.html'}")
    return 1 if erreur else 0


if __name__ == "__main__":
    raise SystemExit(main())
