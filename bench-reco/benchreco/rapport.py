"""Rapport HTML autonome (images intégrées en base64 ; KaTeX chargé depuis un CDN pour l'aperçu)."""
from __future__ import annotations

import base64
import html
import io
import statistics
from dataclasses import dataclass, field

from PIL import Image

from .groupement import Groupe
from .metriques import Score


@dataclass
class Resultat:
    groupe: str
    hauteur: int
    modele: str
    latex: str = ""
    duree_ms: float = 0.0
    erreur: str | None = None
    score: Score | None = None
    confiance: float | None = None  # confiance du modèle dans sa lecture (si fournie)
    tokens: int | None = None
    statut: str = "ok"  # "lecture_echouee" : boucle ou plafond de tokens atteint
    raison: str | None = None


@dataclass
class InfoModele:
    nom: str
    detail: str  # ex. version du paquet + identifiant des poids
    chargement_s: float = 0.0
    import_s: float = 0.0
    prechauffage_s: float = 0.0
    erreur: str | None = None


@dataclass
class Contexte:
    fichier: str
    nb_traits: int
    nb_ignores: int
    h: float
    h_auto: bool
    groupes: list[Groupe]
    apercu: Image.Image
    images: dict[tuple[str, int], Image.Image]  # (groupe, hauteur) -> image envoyée aux modèles
    resultats: list[Resultat]
    modeles: list[InfoModele]
    verite: dict[str, str] | None
    hauteurs: list[int]
    machine: str
    ratio_max: float
    avertissements: list[str] = field(default_factory=list)


def _katex(latex: str) -> str:
    """KaTeX attend une formule nue : on retire les délimiteurs d'affichage ajoutés par certains modèles."""
    s = latex.strip()
    for debut, fin in ((r"\[", r"\]"), ("$$", "$$"), ("$", "$")):
        if s.startswith(debut) and s.endswith(fin) and len(s) >= len(debut) + len(fin):
            return s[len(debut) : -len(fin)].strip()
    return s


def _b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _pct(x: float) -> str:
    return f"{100 * x:.1f} %"


def _quantile(xs: list[float], q: float) -> float:
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * len(xs)))]


CSS = """
body{font:14px/1.45 system-ui,sans-serif;margin:24px auto;max-width:1150px;padding:0 16px;color:#1d2433}
h1{font-size:22px}h2{margin-top:32px;border-bottom:1px solid #d6dbe5;padding-bottom:4px}
table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #d6dbe5;padding:5px 9px;text-align:left;vertical-align:top}
th{background:#f1f4f9}.num{text-align:right;font-variant-numeric:tabular-nums}
.carte{border:1px solid #d6dbe5;border-radius:10px;padding:12px 14px;margin:14px 0}
.carte h3{margin:0 0 6px}.img{background:#fff;border:1px solid #e3e7ef;display:inline-block;margin:4px 8px 4px 0;max-width:100%;overflow:auto}
.img img{display:block;max-width:100%}code{background:#f1f4f9;padding:1px 5px;border-radius:4px;word-break:break-all}
.ok{color:#0a7a3b;font-weight:600}.ko{color:#b3261e;font-weight:600}.warn{color:#9a5b00}.dim{color:#6b7385}
.tag{background:#e8eefc;border-radius:10px;padding:1px 8px;font-size:12px;margin-right:4px}
"""


def generer(c: Contexte) -> str:
    modeles = [m.nom for m in c.modeles]
    par_cle = {(r.groupe, r.hauteur, r.modele): r for r in c.resultats}
    lisibles = [g for g in c.groupes if not g.bruit]
    p: list[str] = []
    w = p.append

    w(f"<!doctype html><meta charset=utf-8><title>Banc de reconnaissance — {html.escape(c.fichier)}</title>")
    w('<link rel=stylesheet href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">')
    w(f"<style>{CSS}</style><h1>Banc de reconnaissance d'écriture mathématique</h1>")
    w(
        f"<p><b>{html.escape(c.fichier)}</b> — {c.nb_traits} traits de stylo ({c.nb_ignores} ignorés), "
        f"h = {c.h:.1f} unités ({'estimée' if c.h_auto else 'imposée'}), {len(lisibles)} groupes à lire "
        f"({len(c.groupes) - len(lisibles)} bruit).<br><span class=dim>{html.escape(c.machine)}</span></p>"
    )
    for a in c.avertissements:
        w(f"<p class=warn>⚠ {html.escape(a)}</p>")

    w("<h2>Regroupement des traits</h2>")
    w(f'<div class=img><img src="{_b64(c.apercu)}" alt="aperçu"></div>')
    w("<p class=dim>Un cadre = un groupe envoyé aux modèles. Si une fraction, un exposant ou une borne est coupé "
      "du reste, ajuste les seuils de <code>config.toml</code>.</p>")

    # ---- Modèles et temps ---------------------------------------------------------------
    w("<h2>Modèles et vitesse (CPU)</h2><table><tr><th>Modèle<th>Poids / version<th>Chargement des poids<th>Import Python<th>Préchauffage (1ʳᵉ lecture)</tr>")
    for m in c.modeles:
        if m.erreur:
            w(f"<tr><td>{html.escape(m.nom)}<td colspan=4 class=ko>{html.escape(m.erreur)}</tr>")
        else:
            w(f"<tr><td>{html.escape(m.nom)}<td>{html.escape(m.detail)}<td class=num>{m.chargement_s:.1f} s<td class=num>{m.import_s:.1f} s<td class=num>{m.prechauffage_s:.1f} s</tr>")
    w("</table>")

    w("<table><tr><th>Modèle<th>Hauteur<th>Lectures<th>Moyenne<th>Médiane<th>90ᵉ centile<th>Max")
    if c.verite:
        w("<th>Exact<th>CER moyen<th>CER médian<th>TER moyen")
    w("</tr>")
    for nom in modeles:
        for hp in c.hauteurs:
            rs = [r for r in c.resultats if r.modele == nom and r.hauteur == hp and not r.erreur]
            if not rs:
                continue
            ms = [r.duree_ms for r in rs]
            w(f"<tr><td>{html.escape(nom)}<td class=num>{hp} px<td class=num>{len(rs)}<td class=num>{statistics.mean(ms):.0f} ms"
              f"<td class=num>{statistics.median(ms):.0f} ms<td class=num>{_quantile(ms, .9):.0f} ms<td class=num>{max(ms):.0f} ms")
            if c.verite:
                sc = [r.score for r in rs if r.score]
                if sc:
                    w(f"<td class=num>{sum(s.exact for s in sc)}/{len(sc)} ({_pct(sum(s.exact for s in sc) / len(sc))})"
                      f"<td class=num>{_pct(statistics.mean(s.cer for s in sc))}<td class=num>{_pct(statistics.median(s.cer for s in sc))}"
                      f"<td class=num>{_pct(statistics.mean(s.ter for s in sc))}")
                else:
                    w("<td colspan=4 class=dim>aucune vérité pour ces groupes")
            w("</tr>")
    w("</table>")
    if c.verite:
        w("<p class=dim>CER = distance d'édition au niveau caractère / longueur de la vérité ; TER = idem au niveau des symboles "
          "LaTeX (<code>\\frac</code>, <code>x</code>, <code>^</code>…). Les deux sont calculés après normalisation "
          "(<code>\\dfrac</code>=<code>\\frac</code>, <code>\\left</code>/<code>\\right</code>, espaces, accolades inutiles…). "
          "« Exact » = identique après normalisation. Le CER n'est pas borné par 100 % (une sortie très longue et fausse le dépasse) : la <b>médiane</b> est plus parlante que la moyenne quand une lecture aberrante tire celle-ci.</p>")
        # meilleure hauteur par groupe (oracle) : sert à voir si la hauteur change quelque chose
        w("<h3>La hauteur d'image change-t-elle quelque chose ?</h3><table><tr><th>Modèle")
        for hp in c.hauteurs:
            w(f"<th>{hp} px : CER moyen")
        w("<th>Meilleure hauteur par groupe (CER moyen)</tr>")
        for nom in modeles:
            w(f"<tr><td>{html.escape(nom)}")
            moy: dict[int, float] = {}
            for hp in c.hauteurs:
                sc = [r.score.cer for r in c.resultats if r.modele == nom and r.hauteur == hp and r.score]
                moy[hp] = statistics.mean(sc) if sc else float("nan")
                w(f"<td class=num>{_pct(moy[hp]) if sc else '—'}")
            meilleurs = []
            for g in lisibles:
                cers = [par_cle[(g.id, hp, nom)].score.cer for hp in c.hauteurs if (g.id, hp, nom) in par_cle and par_cle[(g.id, hp, nom)].score]
                if cers:
                    meilleurs.append(min(cers))
            w(f"<td class=num>{_pct(statistics.mean(meilleurs)) if meilleurs else '—'}</tr>")
        w("</table>")

    # ---- Détail par groupe ------------------------------------------------------------------
    w("<h2>Détail par groupe</h2>")
    for g in c.groupes:
        verite = c.verite.get(g.id) if c.verite else None
        w(f"<div class=carte><h3>{g.id} <span class=dim>— {len(g.indices)} traits, {g.w / c.h:.1f} h × {g.h / c.h:.1f} h</span></h3>")
        for s in g.structures:
            w(f"<span class=tag>{html.escape(s)}</span>")
        for a in g.avertissements:
            w(f"<span class=warn>⚠ {html.escape(a)}</span> ")
        if g.bruit:
            w("</div>")
            continue
        for hp in c.hauteurs:
            img = c.images.get((g.id, hp))
            if img is None:
                continue
            ratio = img.width / img.height
            alerte = f' <span class=warn>⚠ très allongée ({ratio:.0f}:1)</span>' if ratio > c.ratio_max else ""
            w(f'<div><span class=dim>{hp} px ({img.width}×{img.height}){alerte}</span><br><div class=img><img src="{_b64(img)}"></div></div>')
        if verite is not None:
            w(f'<p>Vérité : <code>{html.escape(verite)}</code> <span class="katex-view" data-latex="{html.escape(_katex(verite), quote=True)}"></span></p>')
        elif c.verite is not None:
            w("<p class=dim>Pas de vérité fournie pour ce groupe.</p>")
        w("<table><tr><th>Modèle<th>Hauteur<th>LaTeX lu<th>Aperçu<th>Temps<th>Confiance")
        if verite is not None:
            w("<th>Score")
        w("</tr>")
        for nom in modeles:
            for hp in c.hauteurs:
                r = par_cle.get((g.id, hp, nom))
                if r is None:
                    continue
                if r.erreur:
                    w(f"<tr><td>{html.escape(nom)}<td class=num>{hp}<td colspan=4 class=ko>{html.escape(r.erreur)}</tr>")
                    continue
                w(f"<tr><td>{html.escape(nom)}<td class=num>{hp}<td><code>{html.escape(r.latex)}</code>"
                  f'<td><span class="katex-view" data-latex="{html.escape(_katex(r.latex), quote=True)}"></span><td class=num>{r.duree_ms:.0f} ms'
                  f"<td class=num>{_pct(r.confiance) if r.confiance is not None else '—'}")
                if verite is not None and r.score:
                    cls = "ok" if r.score.exact else "ko"
                    w(f"<td class={cls}>{'exact' if r.score.exact else f'CER {_pct(r.score.cer)}'}")
                w("</tr>")
        w("</table></div>")

    w("""<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script>
document.querySelectorAll('.katex-view').forEach(function(el){
  try{katex.render(el.dataset.latex,el,{throwOnError:false,displayMode:false});}
  catch(e){el.textContent='(aperçu indisponible)';el.className='dim';}
});
</script>""")
    return "\n".join(p)
