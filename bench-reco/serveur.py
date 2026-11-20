"""Serveur local de lecture pour le bouton « Corriger » de l'app.

    bench-reco\.venv\Scripts\python bench-reco\serveur.py [--port 8765] [--http]

POST /lire      (corps = feuille, format léger) → lit en arrière-plan les groupes pas encore en cache ; annulée par toute requête plus récente
POST /corriger  (corps = JSON de la feuille exportée par l'app)
  → { "groupes": [ { "id", "x0", "y0", "x1", "y1", "latex", "type" } ], "annotations": [ … ],
      "correction": { backend, durées, tailles… } ou "erreur_correction": "…", "duree_s": … }
GET  /sante     → { "ok": true, "modele": … }

Le regroupement et le rendu sont ceux du banc (config.toml) ; TexTeller est chargé une fois au démarrage.
HTTPS avec le certificat mkcert de ../certs (l'app est servie en HTTPS : un appel http: serait bloqué).
"""
from __future__ import annotations

import argparse
import base64
import json
import ssl
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from benchreco.config import Config
from correction import ErreurCorrection, corriger
import tempfile

from datetime import datetime

from cours import elaborer
from discussion import reprendre
from page_image import nb_bandes, rendre_page, rendre_zone
from pipeline import Lecteur, StatsLecture

ICI = Path(__file__).resolve().parent
TAILLE_MAX = 30 * 1024 * 1024

cfg = Config.charger(None)
lecteur = Lecteur(cfg)
ENTREE = cfg.correction.entree if cfg.correction.entree in ("image", "ocr", "ocr_image") else "image"
OCR = ENTREE in ("ocr", "ocr_image")  # TexTeller n'est chargé et utilisé que si Claude reçoit aussi (ou seulement) la lecture OCR


def lire_en_fond(brut: dict) -> dict:
    """/lire : lit les groupes pas encore en cache (lecture en arrière-plan pendant que l'élève écrit).

    S'arrête dès qu'une requête plus récente arrive ou qu'une correction est demandée ; les groupes déjà lus restent en cache."""
    if not OCR:  # entrée « image » : rien à lire d'avance, l'app peut cesser d'envoyer des /lire
        return {"inactif": True, "lus": 0, "cache": 0, "echecs": 0, "annulee": False, "duree_s": 0}
    version = lecteur.nouvelle_requete()
    opts = brut.pop("options", None) or {}
    ignorer = opts.get("ignorer_couleurs")
    stats = StatsLecture()
    lecteur.lire(
        brut, ignorer if isinstance(ignorer, list) else None,
        annuler=lambda: lecteur.version != version or lecteur.prioritaires > 0, stats=stats,
    )
    print(f"/lire : {stats.lus} lus ({stats.tokens} tokens, {stats.echecs} échecs), {stats.cache} en cache, "
          f"{'annulée, ' if stats.annulee else ''}{stats.duree_s} s", flush=True)
    return {"lus": stats.lus, "cache": stats.cache, "echecs": stats.echecs, "annulee": stats.annulee, "duree_s": stats.duree_s}


def _precisions(opts: dict) -> dict[str, str]:
    """Précisions de l'élève, par empreinte de ligne : { empreinte: texte }."""
    return {p["empreinte"]: str(p["texte"])[:600] for p in (opts.get("precisions") or []) if isinstance(p, dict) and p.get("empreinte") and p.get("texte")}


PHOTOS_MAX = 6
PHOTO_OCTETS_MAX = 6 * 1024 * 1024
TYPES_PHOTO = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


def _photos(opts: dict, dossier: Path) -> list[Path]:
    """Photos de l'énoncé jointes par l'élève (data URL JPEG/PNG/WebP) : écrites dans `dossier` sous enonce_N.ext, pour être lues par Claude."""
    sorties: list[Path] = []
    for src in (opts.get("photos") or [])[:PHOTOS_MAX]:
        if not isinstance(src, str) or not src.startswith("data:") or ";base64," not in src:
            continue
        entete, donnees = src[5:].split(";base64,", 1)
        ext = TYPES_PHOTO.get(entete.lower())
        if not ext:
            continue
        try:
            octets = base64.b64decode(donnees, validate=False)
        except ValueError:
            continue
        if not octets or len(octets) > PHOTO_OCTETS_MAX:
            continue
        chemin = dossier / f"enonce_{len(sorties) + 1}.{ext}"
        chemin.write_bytes(octets)
        sorties.append(chemin)
    return sorties


def _blocs(opts: dict) -> list[dict]:
    """Énoncés d'exercices posés sur la feuille (page de cours) : { numero, enonce, zone: [x0, y0, x1, y1] } ; la zone est l'espace de réponse sous l'énoncé."""
    sorties: list[dict] = []
    for b in (opts.get("blocs") or [])[:40]:
        zone = b.get("zone") if isinstance(b, dict) else None
        if not (isinstance(zone, list) and len(zone) == 4 and all(isinstance(v, (int, float)) for v in zone)) or not str(b.get("enonce", "")).strip():
            continue
        sorties.append({"numero": b.get("numero"), "enonce": str(b["enonce"]).strip()[:900], "zone": [round(float(v), 1) for v in zone]})
    return sorties


def _sauver_correction_lecture(g, precision: dict, lecture_corrigee: str, res_annotations: list[dict]) -> None:
    """Garde l'image de la ligne et ce que l'élève a dit avoir écrit : donnée précieuse pour évaluer ou affiner la lecture plus tard (local, hors dépôt)."""
    dossier = ICI / "corrections_lecture"
    dossier.mkdir(exist_ok=True)
    nom = f"{datetime.now().strftime('%Y-%m-%d_%H%M%S')}_{g.empreinte[:8]}"
    if g.rendre:
        g.rendre(256).save(dossier / f"{nom}.png")
    (dossier / f"{nom}.json").write_text(json.dumps({
        "date": datetime.now().isoformat(timespec="seconds"), "empreinte": g.empreinte, "groupe": g.id,
        "precision_eleve": precision.get("texte"), "lu_par_claude": precision.get("lu"), "propose_par_claude": precision.get("propose"),
        "lecture_corrigee_latex": lecture_corrigee or None, "annotations_apres": [a for a in res_annotations if a.get("groupe") == g.id],
    }, ensure_ascii=False, indent=2), encoding="utf-8")


def discuter(brut: dict) -> dict:
    """/discuter : l'élève précise ce qu'il a écrit, répond à une lecture douteuse ou écrit un message.

    options : { precision?: {empreinte, texte, lu?, propose?}, message?, cibles?: [empreinte], zone_traits?: [id de trait],
                annotations_actuelles: [{empreinte, type, note?, extrait?, lu?, propose?}], precisions: [{empreinte, texte}], historique: [{role, texte}],
                mode, ton, zone, enonce, ignorer_couleurs }"""
    t0 = time.perf_counter()
    lecteur.nouvelle_requete()
    opts = brut.pop("options", None) or {}
    ignorer = opts.get("ignorer_couleurs")
    feuille, h, groupes = lecteur.lire(brut, ignorer if isinstance(ignorer, list) else None, ocr=False)
    par_emp = {g.empreinte: g for g in groupes if g.empreinte}
    precision = opts.get("precision") if isinstance(opts.get("precision"), dict) else None
    precisions = _precisions(opts)
    cibles = [e for e in (opts.get("cibles") or []) if e in par_emp]
    if precision and precision.get("empreinte") in par_emp:
        if precision["empreinte"] not in cibles:
            cibles.insert(0, precision["empreinte"])
        precisions[precision["empreinte"]] = str(precision.get("texte", ""))[:600]
    zone_ids = {str(i) for i in (opts.get("zone_traits") or [])}
    if zone_ids and not cibles:  # une zone entourée désigne les lignes dont au moins la moitié des traits y sont
        cibles = [g.empreinte for g in groupes if g.empreinte and g.traits_ids and sum(i in zone_ids for i in g.traits_ids) * 2 >= len(g.traits_ids)][:3]
    if (precision or opts.get("cibles")) and not cibles and not zone_ids:
        return {"message": "Cette ligne a changé depuis la correction : touche « Corriger » pour que je la relise.", "annotations": [], "retirer": [], "groupes": []}
    actuelles = [
        {"groupe": par_emp[a["empreinte"]].id, **{k: a[k] for k in ("type", "note", "extrait", "lu", "propose") if a.get(k)}}
        for a in (opts.get("annotations_actuelles") or []) if isinstance(a, dict) and a.get("empreinte") in par_emp
    ]
    with tempfile.TemporaryDirectory(prefix="reprise_") as td:
        d = Path(td)
        (d / "photos_enonce").mkdir()
        pages = rendre_page(feuille.traits, groupes, h, d, "page", nb_bandes(groupes, h, float(cfg.correction.bande_hauteur_h), int(cfg.correction.bandes_max)))
        extra: list[Path] = []
        for e in cibles[:3]:  # gros plan des lignes concernées, sans cadres
            g = par_emp[e]
            m = 1.2 * h
            extra.append(d / f"gros_plan_{g.id}.png")
            rendre_zone(feuille.traits, groupes, h, (g.x0 - m, g.y0 - m, g.x1 + m, g.y1 + m), extra[-1], cadres=False)
        if zone_ids:  # zone montrée par l'élève (lasso) : seulement ses traits, en gros plan
            sel = [t for t in feuille.traits if t.id in zone_ids]
            if sel:
                m = 1.0 * h
                zone = (min(t.x0 for t in sel) - m, min(t.y0 for t in sel) - m, max(t.x1 for t in sel) + m, max(t.y1 for t in sel) + m)
                extra.append(d / "zone_montree.png")
                rendre_zone(feuille.traits, groupes, h, zone, extra[-1], cadres=False, seulement=zone_ids)
        res = reprendre(
            cfg.correction, groupes, pages + extra, len(pages), actuelles, [par_emp[e].id for e in cibles], precision, opts.get("message"),
            opts.get("historique") or [], opts.get("enonce"), opts.get("mode"), opts.get("ton"), opts.get("zone") or "feuille", precisions,
            photos=_photos(opts, d / "photos_enonce"), blocs=_blocs(opts),
        )
    if precision and precision.get("empreinte") in par_emp and str(precision.get("texte", "")).strip():
        _sauver_correction_lecture(par_emp[precision["empreinte"]], precision, res["lecture_corrigee"], res["annotations"])
    id_vers_emp = {g.id: g.empreinte for g in groupes}
    concernes = {a["groupe"] for a in res["annotations"] if a.get("groupe")} | set(res["retirer"]) | {par_emp[e].id for e in cibles} | {e["groupe"] for e in res["explications"]}
    return {
        "message": res["message"],
        "annotations": [{**a, "empreinte": id_vers_emp[a["groupe"]]} for a in res["annotations"] if a.get("groupe")],
        "retirer": [id_vers_emp[g] for g in res["retirer"]],
        "explications": [{"empreinte": id_vers_emp[e["groupe"]], "texte": e["texte"]} for e in res["explications"]],
        "groupes": [{"empreinte": g.empreinte, "id": g.id, "x0": g.x0, "y0": g.y0, "x1": g.x1, "y1": g.y1} for g in groupes if g.id in concernes],
        "lecture_corrigee": res["lecture_corrigee"], "meta": res["meta"], "duree_s": round(time.perf_counter() - t0, 2),
    }


def cours(brut: dict) -> dict:
    """/cours : crée un cours (options.mode = creer) ou répond à une demande sur un cours existant (modifier). Pas de feuille : texte seul, plus les photos jointes."""
    t0 = time.perf_counter()
    opts = brut.get("options") or {}
    with tempfile.TemporaryDirectory(prefix="cours_") as td:
        photos = _photos(opts, Path(td))
        try:
            res = elaborer(cfg.correction, opts, photos)
        except ErreurCorrection as e:
            print(f"cours impossible : {e}", file=sys.stderr, flush=True)
            return {"erreur_cours": str(e), "duree_s": round(time.perf_counter() - t0, 2)}
    res["duree_s"] = round(time.perf_counter() - t0, 2)
    return res


def traiter(brut: dict) -> dict:
    """Corps = feuille de l'app + { "options": { ignorer_couleurs, mode, ton, enonce, lecture_seule } } facultatif."""
    t0 = time.perf_counter()
    lecteur.nouvelle_requete()  # annule une lecture en arrière-plan en cours
    opts = brut.pop("options", None) or {}
    ignorer = opts.get("ignorer_couleurs")
    stats = StatsLecture()
    with lecteur.prioritaire():
        feuille, h, groupes = lecteur.lire(brut, ignorer if isinstance(ignorer, list) else None, stats=stats, ocr=OCR)
    rep: dict = {"entree": ENTREE, "groupes": [g.vers_json() for g in groupes if g.latex is not None]}
    rep["empreintes"] = [g.empreinte for g in groupes if g.empreinte]  # toutes les lignes, y compris figures et règles (non renvoyées dans « groupes »)
    rep["duree_lecture_s"] = round(time.perf_counter() - t0, 2)
    rep["lecture"] = {"lus": stats.lus, "cache": stats.cache, "echecs": stats.echecs, "tokens": stats.tokens}
    # Correction partielle : l'app liste les lignes (empreintes) déjà corrigées ; celles qui n'ont pas changé ne sont pas refaites.
    deja = opts.get("deja_corrigees")
    inchanges = {g.id for g in groupes if g.empreinte and isinstance(deja, list) and g.empreinte in set(map(str, deja))} if (opts.get("zone") or "feuille") == "feuille" else set()
    if inchanges and len(inchanges) == sum(1 for g in groupes if g.empreinte):  # les groupes de bruit (sans empreinte) ne comptent pas
        rep["annotations"], rep["rien_de_nouveau"] = [], True
        print("correction : rien de nouveau, Claude n'est pas appelé", flush=True)
    elif not opts.get("lecture_seule"):
        try:
            with tempfile.TemporaryDirectory(prefix="pages_") as dossier:
                images = None
                (Path(dossier) / "photos_enonce").mkdir()
                if ENTREE != "ocr":  # la feuille en images : traits noirs, groupes encadrés et numérotés (mêmes ids que ceux renvoyés à l'app)
                    n = nb_bandes(groupes, h, float(cfg.correction.bande_hauteur_h), int(cfg.correction.bandes_max))
                    images = rendre_page(feuille.traits, groupes, h, Path(dossier), "page", n)
                res = corriger(cfg.correction, groupes, opts.get("enonce"), opts.get("mode"), opts.get("ton"), opts.get("zone") or "feuille",
                               images=images, entree=ENTREE, precisions=_precisions(opts), photos=_photos(opts, Path(dossier) / "photos_enonce"), inchanges=inchanges, blocs=_blocs(opts))
            rep["annotations"], rep["correction"] = res["annotations"], res["meta"]
            rep["explications"] = res.get("explications", [])
        except ErreurCorrection as e:
            print(f"correction impossible : {e}", file=sys.stderr, flush=True)
            rep["annotations"], rep["erreur_correction"] = [], str(e)
    rep["duree_s"] = round(time.perf_counter() - t0, 2)
    return rep


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _envoyer(self, code: int, corps: dict) -> None:
        data = json.dumps(corps, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def _cors(self) -> None:
        # Réseau local, un seul utilisateur : l'app est servie depuis un autre port du même PC.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/sante":
            self._envoyer(200, {"ok": True, "modele": lecteur.modele.detail() if OCR else None, "correction": cfg.correction.backend, "entree": ENTREE})
        else:
            self._envoyer(404, {"erreur": "introuvable"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path not in ("/corriger", "/lire", "/discuter", "/cours"):
            self._envoyer(404, {"erreur": "introuvable"})
            return
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > TAILLE_MAX:
            self._envoyer(413, {"erreur": "corps vide ou trop gros"})
            return
        try:
            brut = json.loads(self.rfile.read(n))
            self._envoyer(200, {"/corriger": traiter, "/lire": lire_en_fond, "/discuter": discuter, "/cours": cours}[self.path](brut))
        except (ValueError, KeyError) as e:  # JSON invalide, aucun trait…
            self._envoyer(400, {"erreur": str(e)})
        except Exception as e:  # noqa: BLE001 — on renvoie l'erreur à l'app plutôt que de couper la connexion
            print(f"erreur : {e!r}", file=sys.stderr)
            self._envoyer(500, {"erreur": f"{type(e).__name__}: {e}"})

    def log_message(self, fmt: str, *args) -> None:
        print(f"{self.address_string()} {fmt % args}", flush=True)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--http", action="store_true", help="sans HTTPS (tests locaux seulement)")
    args = ap.parse_args()

    if OCR:
        print("Chargement de TexTeller…", flush=True)
        lecteur.charger()
        print(lecteur.modele.detail(), flush=True)
    else:
        print("Entrée « image » : TexTeller n'est pas chargé.", flush=True)
    print(f"Correction : backend {cfg.correction.backend}, modèle {cfg.correction.modele}, entrée {ENTREE}, vérification {'oui' if cfg.correction.verification else 'non'}", flush=True)

    srv = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    schema = "http"
    if not args.http:
        cert, cle = ICI.parent / "certs" / "dev.pem", ICI.parent / "certs" / "dev-key.pem"
        if not (cert.exists() and cle.exists()):
            print("certs/dev.pem introuvable : voir README (mkcert), ou lancer avec --http pour un test local.", file=sys.stderr)
            return 1
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cert, cle)
        srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
        schema = "https"
    print(f"Prêt : {schema}://0.0.0.0:{args.port}  (Ctrl+C pour arrêter)", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
