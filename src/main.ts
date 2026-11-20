import './style.css';
import { ENONCE_MAX, LARGEUR_FEUILLE, MARGE_BAS, HAUTEUR_MIN, lireFeuille, nouvelId, versFeuille, versFeuilleLegere, type Fond, type Outil, type Point, type Trait } from './model';
import { Viewport } from './viewport';
import { Layer, type Rect } from './render/layers';
import { bboxOf, drawLiveStroke, drawTrait, drawVisible } from './render/ink';
import { setFond, updatePage } from './render/background';
import { setupTouch } from './input/touch';
import { Store } from './store';
import { selectInside, sweepHits } from './tools/geometry';
import { trouverCibles } from './tools/scribble';
import { genere, reconnaitre, type Forme } from './tools/shape';
import { charger, demanderStockageDurable, sauverMaintenant, sauverPlusTard } from './persist';
import { choisirPage, chargerPages, creerPage, pageCourante, pageExiste, renommerPage, supprimerPage } from './pages';
import { createPages } from './ui/pages';
import { createCours } from './ui/cours';
import { chargerCours, definirPageCours, trouverCours, type Exercice, type SectionCours } from './cours';
import { ajouterEnBas, basBloc, blocsPourServeur, chargerBlocs, decalerBlocs, listeBlocs, majBloc, PLACE_SUPPLEMENTAIRE, remplacerBlocs, retirerBloc, sauverBlocs, trouverBloc, type BrouillonBloc, type Bloc } from './blocs';
import { LARGEUR_BLOC, poserBloc } from './blocs';
import { createBlocsFeuille, mesurerTexte, polices } from './render/blocs';
import { createBlocCadre } from './ui/bloc-cadre';
import { blocsDuCours, blocsNouveauxExercices, blocsSections } from './page-cours';
import { ajouterUsage, chargerUsage, resumeUsage, usageCourant } from './usage';
import { chargerPhotos, definirPos, listePhotos, photosPourServeur, recadrerPhoto, remplacerPhotos, retirerPhoto, sauverPhotos, type Photo } from './photos';
import { createPhotosFeuille, hauteurPhoto } from './render/photos';
import { createPhotoCadre } from './ui/photo-cadre';
import { ouvrirVisionneuse } from './ui/photo';
import { registerSW } from 'virtual:pwa-register';
import { COULEURS, EPAISSEURS, createToolbar, type ReglagesCorrection } from './ui/toolbar';
import { createResultats } from './ui/resultats';
import { createNotes } from './ui/notes';
import { createLectureFond } from './lecture';
import { chargerConversation } from './conversation';
import { ajouterPrecision, chargerPrecisions, elaguerPrecisions, precisionsPourServeur } from './precisions';
import { dessinerAnnotations } from './render/annotations';
import { appliquerReprise, basculerVisibilite, decalerAnnotations, chargerAnnotations, effacerAnnotations, etat as annotationsEtat, poserAnnotations, reevaluer } from './annotations';
import { ErreurReco, corrigerFeuille, discuter, type GroupeLu, type Reprise } from './reco';

// Empêche les gestes Safari (pinch de page, double-tap) et le menu contextuel.
for (const ev of ['gesturestart', 'gesturechange', 'gestureend', 'contextmenu', 'selectstart', 'dragstart']) {
  document.addEventListener(ev, (e) => {
    // Le champ d'énoncé doit rester utilisable : curseur, sélection, copier-coller.
    if (e.target instanceof Element && e.target.closest('textarea, input')) return;
    e.preventDefault();
  });
}

// Mode debug (?debug) : affiche les derniers événements, utile pour régler la paume.
const params = new URLSearchParams(location.search);
const debugEl = params.has('debug') ? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'debug' })) : null;
const lignes: string[] = [];
function log(s: string) {
  if (!debugEl) return;
  lignes.push(s);
  if (lignes.length > 6) lignes.shift();
  debugEl.textContent = lignes.join('\n');
}

const root = document.getElementById('sheet')!;
const viewport = new Viewport();
const store = new Store();

// Du fond vers le dessus : page (CSS), calques en cache (enveloppe transformable), trait en cours.
const page = Object.assign(document.createElement('div'), { id: 'page' });
const inkWrap = Object.assign(document.createElement('div'), { id: 'inkwrap' });
const selBox = Object.assign(document.createElement('div'), { id: 'selbox' });
const surligne = Object.assign(document.createElement('div'), { id: 'surligne' }); // groupe lu, touché dans le panneau
root.append(page, inkWrap);
const photosFeuille = createPhotosFeuille(root, inkWrap); // photos d'énoncé posées sur la feuille (sous l'encre)
const blocsFeuille = createBlocsFeuille(root, inkWrap); // texte du cours « écrit à la main » (sous l'encre)
const encre = new Layer(inkWrap); // traits validés (cache)
const annotations = new Layer(inkWrap); // corrections de l'IA : cercles, coches, soulignements (les notes sont en HTML, voir ui/notes.ts)
const live = new Layer(root, { desynchronized: true }); // trait en cours
root.append(selBox, surligne);
const cadrePhoto = createPhotoCadre(root, viewport, {
  onChange(id, pos) {
    definirPos(id, pos, false);
    cadrePhoto.afficher(listePhotos().find((p) => p.id === id) ?? null);
    rendrePhotos();
  },
  onFin() {
    sauverPhotos();
    updateHeight();
    fullRender();
  },
  onRecadrer(id) {
    const photo = listePhotos().find((p) => p.id === id);
    if (!photo) return;
    ouvrirVisionneuse(
      photo,
      {
        async onRecadrer(p, x, y, w, h) {
          const maj = await recadrerPhoto(p.id, x, y, w, h);
          resultats.majPhotos();
          selectionnerPhoto(maj.id);
          updateHeight();
          fullRender();
          return maj;
        },
        onSupprimer(p) {
          retirerPhoto(p.id);
          resultats.majPhotos();
          selectionnerPhoto(null);
          fullRender();
        },
      },
      { recadrerDirect: true },
    );
  },
  onRetirer(id) {
    definirPos(id, undefined);
    selectionnerPhoto(null);
    fullRender();
    toolbar.toast("Photo retirée de la feuille (elle reste dans l'énoncé)", 2500);
  },
  onFermer: () => selectionnerPhoto(null),
});
const cadreBloc = createBlocCadre(root, viewport, {
  onChange(id, patch) {
    majBloc(id, patch, false);
    cadreBloc.afficher(trouverBloc(id) ?? null);
    rendrePhotos();
  },
  onFin() {
    sauverBlocs();
    updateHeight();
    fullRender();
  },
  onAction(id, action) {
    const b = trouverBloc(id);
    if (!b) return;
    if (action === 'fermer') return selectionnerBloc(null);
    if (action === 'supprimer') {
      retirerBloc(id);
      selectionnerBloc(null);
      updateHeight();
      fullRender();
      return;
    }
    if (action === 'place') return insererPlace(b);
    if (b.coursId && b.exerciceId) coursUi.ouvrirExercice(b.coursId, b.exerciceId, action);
  },
});
const notes = createNotes(root, () => store.traits);

const style: { couleur: string; epaisseur: number } = { couleur: COULEURS[0], epaisseur: EPAISSEURS[0] };
const GOMME_PX = 12; // rayon de la gomme à l'écran
const USE_PREDICTED = false;

const GRIBOUILLE_KEY = 'tutorat.gribouille';
let gribouille = true; // gribouiller sur un tracé l'efface
try {
  gribouille = localStorage.getItem(GRIBOUILLE_KEY) !== '0';
} catch {
  /* stockage indisponible : activé par défaut */
}

const FORMES_KEY = 'tutorat.formes';
let formes = true; // maintenir le stylet immobile redresse le trait
try {
  formes = localStorage.getItem(FORMES_KEY) !== '0';
} catch {
  /* stockage indisponible : activé par défaut */
}
const MAINTIEN_MS = 550;
const MAINTIEN_PX = 4; // tolérance de tremblement pendant le maintien

let outil: Outil = 'stylo';
const hidden = new Set<Trait>(); // traits effacés pendant le geste de gomme
const selection = new Set<Trait>();
const drag = { dx: 0, dy: 0 };

const fondParam = params.get('fond');
let fond: Fond = fondParam === 'carreaux' || fondParam === 'ligne' ? fondParam : 'blanc';
setFond(page, fond);

// --- Rendu --------------------------------------------------------------
/** Viewport utilisé lors du dernier rendu des calques en cache. */
let rendered = { scale: 1, tx: 0, ty: 0 };

/** Photos posées sur la feuille : redessinées avec la vue, et cadre d'édition de la photo sélectionnée. */
function rendrePhotos() {
  photosFeuille.rendre(listePhotos(), viewport);
  blocsFeuille.rendre(listeBlocs(), viewport);
  cadrePhoto.suivre();
  cadreBloc.suivre();
}

function selectionnerPhoto(id: string | null) {
  cadrePhoto.afficher(id ? (listePhotos().find((p) => p.id === id && p.pos) ?? null) : null);
  if (id) cadreBloc.afficher(null);
  rendrePhotos();
}

function selectionnerBloc(id: string | null) {
  cadreBloc.afficher(id ? (trouverBloc(id) ?? null) : null);
  if (id) cadrePhoto.afficher(null);
  rendrePhotos();
}

/** Bas de tout ce qui est écrit ou posé sur la page (traits, photos, blocs) ; 40 pour une page vide. */
function contenuBas(): number {
  let y = 0;
  for (const t of store.traits) y = Math.max(y, bboxOf(t).y1);
  for (const p of listePhotos()) if (p.pos) y = Math.max(y, p.pos.y + hauteurPhoto(p));
  for (const b of listeBlocs()) y = Math.max(y, basBloc(b));
  return y ? y + 50 : 40;
}

/** Fait descendre de `dy` tout ce qui est sous `seuil` : blocs, photos, tracés (par leur centre) et annotations. */
function decalerSous(seuil: number, dy: number, sauf?: string) {
  decalerBlocs(seuil, dy, sauf);
  for (const p of listePhotos()) if (p.pos && p.pos.y >= seuil) definirPos(p.id, { ...p.pos, y: p.pos.y + dy }, false);
  sauverPhotos();
  silencieux = true;
  try {
    store.decaler(store.traits.filter((t) => (bboxOf(t).y0 + bboxOf(t).y1) / 2 >= seuil), dy);
  } finally {
    silencieux = false;
  }
  decalerAnnotations(seuil, dy, store.traits);
}

/**
 * Le tuteur écrit ses explications à la main, chacune juste sous la ligne concernée : la place est faite en descendant tout le reste
 * (et en allongeant l'espace de réponse de l'exercice qui contient la ligne). De bas en haut, pour que les positions des lignes encore à traiter restent justes.
 */
async function poserExplications(liste: { texte: string; bbox: [number, number, number, number] }[]): Promise<number> {
  if (!liste.length) return 0;
  await polices();
  for (const e of [...liste].sort((a, b) => b.bbox[3] - a.bbox[3])) {
    const seuil = Math.ceil(e.bbox[3]) + 6;
    const h = mesurerTexte({ type: 'tuteur', texte: e.texte, l: LARGEUR_BLOC });
    const dy = h + 18;
    for (const b of listeBlocs()) if (b.type === 'exercice' && b.y + b.hTexte <= seuil && seuil < basBloc(b)) majBloc(b.id, { reserve: b.reserve + dy }, false);
    decalerSous(seuil, dy);
    await poserBloc({ type: 'tuteur', texte: e.texte }, seuil);
  }
  sauverBlocs();
  notes.reconstruire();
  renderAnnotations();
  updateHeight();
  fullRender();
  return liste.length;
}

/** Les explications d'une réponse du tuteur (discussion, précision) s'écrivent sur la feuille, chacune sous sa ligne. */
async function ecrireExplications(rep: Reprise) {
  const parEmp = new Map(rep.groupes.map((g) => [g.empreinte, g]));
  const n = await poserExplications(
    (rep.explications ?? []).flatMap((e) => {
      const g = parEmp.get(e.empreinte);
      return g ? [{ texte: e.texte, bbox: [g.x0, g.y0, g.x1, g.y1] as [number, number, number, number] }] : [];
    }),
  );
  if (n) toolbar.toast(`Le tuteur a écrit ${n} explication${n > 1 ? 's' : ''} sur la page`, 3500);
}

/** « + de place » sous un bloc : l'espace de réponse s'allonge (exercice) et tout ce qui est en dessous descend, tracés et annotations compris. */
function insererPlace(b: Bloc) {
  const seuil = basBloc(b);
  const dy = PLACE_SUPPLEMENTAIRE;
  if (b.type === 'exercice') majBloc(b.id, { reserve: b.reserve + dy }, false);
  decalerSous(seuil, dy, b.id);
  notes.reconstruire();
  updateHeight();
  fullRender();
  toolbar.toast(`${dy} unités d\u2019espace ajoutées`, 1500);
}

function updateHeight() {
  let maxY = 0;
  for (const t of store.traits) maxY = Math.max(maxY, bboxOf(t).y1);
  for (const p of listePhotos()) if (p.pos) maxY = Math.max(maxY, p.pos.y + hauteurPhoto(p));
  for (const b of listeBlocs()) maxY = Math.max(maxY, basBloc(b));
  viewport.sheetH = Math.max(HAUTEUR_MIN, maxY + MARGE_BAS);
  viewport.clamp();
}

/** Redessine proprement les calques en cache au viewport courant. */
function renderInk() {
  rendered = { scale: viewport.scale, tx: viewport.tx, ty: viewport.ty };
  encre.clear();
  encre.applyViewport(rendered);
  drawVisible(encre.ctx, store.traits, encre.visibleRect(rendered), { hidden, selected: selection, dx: drag.dx, dy: drag.dy });
  renderAnnotations();
  inkWrap.style.transform = '';
}

/** Calque des annotations de l'IA, au viewport du dernier rendu (comme l'encre). */
function renderAnnotations() {
  annotations.clear();
  if (!annotationsEtat.visibles || annotationsEtat.items.length === 0) return;
  annotations.applyViewport(rendered);
  dessinerAnnotations(annotations.ctx, annotationsEtat.items, annotations.visibleRect(rendered));
}

function refreshAnnotationsBtn() {
  toolbar.setAnnotations(annotationsEtat.items.length > 0, annotationsEtat.visibles);
}

function selBounds(): Rect | null {
  if (selection.size === 0) return null;
  const r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const t of selection) {
    const b = bboxOf(t);
    r.x0 = Math.min(r.x0, b.x0);
    r.y0 = Math.min(r.y0, b.y0);
    r.x1 = Math.max(r.x1, b.x1);
    r.y1 = Math.max(r.y1, b.y1);
  }
  return r;
}

function updateSelBox() {
  const b = selBounds();
  if (!b) {
    selBox.style.display = 'none';
    return;
  }
  const s = viewport.scale;
  selBox.style.display = 'block';
  selBox.style.width = `${(b.x1 - b.x0) * s}px`;
  selBox.style.height = `${(b.y1 - b.y0) * s}px`;
  selBox.style.transform = `translate(${viewport.tx + (b.x0 + drag.dx) * s}px, ${viewport.ty + (b.y0 + drag.dy) * s}px)`;
}

/** Cadre autour du groupe choisi dans le panneau des résultats (coordonnées feuille). */
let cadre: GroupeLu | null = null;
function updateSurligne() {
  if (!cadre) {
    surligne.style.display = 'none';
    return;
  }
  const s = viewport.scale;
  const m = 4; // marge de respiration, unités feuille
  surligne.style.display = 'block';
  surligne.style.width = `${(cadre.x1 - cadre.x0 + 2 * m) * s}px`;
  surligne.style.height = `${(cadre.y1 - cadre.y0 + 2 * m) * s}px`;
  surligne.style.transform = `translate(${viewport.tx + (cadre.x0 - m) * s}px, ${viewport.ty + (cadre.y0 - m) * s}px)`;
}

function refreshToolbar() {
  toolbar.update({ canUndo: store.canUndo, canRedo: store.canRedo, selection: selection.size > 0 });
}

/** Pendant un geste : transformation CSS du cache, redessin seulement si on déborde. */
function syncView() {
  raf = 0;
  updatePage(page, viewport);
  updateSelBox();
  updateSurligne();
  rendrePhotos();
  notes.suivre(viewport);
  const k = viewport.scale / rendered.scale;
  const dx = viewport.tx - k * rendered.tx;
  const dy = viewport.ty - k * rendered.ty;
  // Zone de l'écran, exprimée dans le repère du dernier rendu.
  const x0 = -dx / k;
  const y0 = -dy / k;
  const x1 = (viewport.W - dx) / k;
  const y1 = (viewport.H - dy) / k;
  const deborde = x0 < -encre.mx || y0 < -encre.my || x1 > viewport.W + encre.mx || y1 > viewport.H + encre.my;
  if (deborde || k > 1.6) {
    renderInk();
  } else {
    inkWrap.style.transform = `translate(${dx}px, ${dy}px) scale(${k})`;
  }
}

let raf = 0;
function scheduleSync() {
  if (!raf) raf = requestAnimationFrame(syncView);
}

function fullRender() {
  updatePage(page, viewport);
  updateSelBox();
  updateSurligne();
  rendrePhotos();
  notes.suivre(viewport);
  renderInk();
  refreshToolbar();
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const mx = Math.round(w * 0.1);
  const my = Math.round(h * 0.25);
  viewport.setScreen(w, h);
  encre.resize(w, h, dpr, mx, my);
  annotations.resize(w, h, dpr, mx, my);
  live.resize(w, h, dpr);
  fullRender();
}

// --- Sauvegarde automatique ----------------------------------------------
/** Vrai pendant un décalage voulu par l'app (« + de place », explication du tuteur) : le panneau ouvert ne doit pas se refermer. */
let silencieux = false;
function sauver() {
  if (!silencieux) fermerResultats(); // la feuille a changé : les lignes lues ne correspondent plus
  if (reevaluer(store.traits)) {
    // Une ligne annotée a été modifiée : son annotation s'estompe.
    notes.majEstompage();
    renderAnnotations();
  }
  persister();
  lectureFond.planifier();
}
store.onChange = sauver;

/** Lecture des groupes en arrière-plan : le serveur lit ce qui a changé pendant que l'élève continue d'écrire. */
const lectureFond = createLectureFond({
  feuille: () => versFeuilleLegere(store.traits, fond),
  ecrit: () => mode !== null,
});

/** Enregistre la feuille (traits, fond, énoncé) peu après ; sans fermer le panneau (frappe de l'énoncé). */
function persister() {
  sauverPlusTard(() => versFeuille(store.traits, fond, enonce));
}

// --- Réglages de la correction et énoncé ---------------------------------
const CORRECTION_KEY = 'tutorat.correction';
const reglagesCorrection: ReglagesCorrection = { mode: 'tout', zone: 'feuille', ton: 'bref', portee: 'modifiees' };
try {
  const brut = JSON.parse(localStorage.getItem(CORRECTION_KEY) ?? 'null') as Partial<ReglagesCorrection> | null;
  if (brut?.mode && ['tout', 'sans_solution', 'indice', 'resultat_final'].includes(brut.mode)) reglagesCorrection.mode = brut.mode;
  if (brut?.zone === 'selection') reglagesCorrection.zone = 'selection';
  if (brut?.ton === 'detaille') reglagesCorrection.ton = 'detaille';
  if (brut?.portee === 'toutes') reglagesCorrection.portee = 'toutes';
} catch {
  /* stockage indisponible : réglages par défaut */
}
/** Énoncé de l'exercice, enregistré avec la feuille. */
let enonce = '';

// --- Lecture (bouton Corriger) -------------------------------------------
/** Zone entourée au lasso pour être montrée au tuteur (dans la discussion). */
let zoneMontree = false;

/** Les annotations posées sur la feuille, telles que le tuteur doit les connaître pour les mettre à jour. */
function annotationsActuelles() {
  return annotationsEtat.items
    .filter((a) => a.empreinte)
    .map((a) => ({ empreinte: a.empreinte!, type: a.type, note: a.note, extrait: a.extrait, lu: a.lu, propose: a.propose }));
}

const resultats = createResultats({
  onSelect(g) {
    cadre = g;
    updateSurligne();
    if (g) centrerSur(g);
  },
  onClose: fermerResultats,
  async onMessage(texte, cible, historique) {
    const zoneIds = zoneMontree ? [...selection].map((t) => t.id) : [];
    reseau++;
    let rep;
    try {
      rep = await discuter(versFeuilleLegere(store.traits, fond, enonce), { ...reglagesCorrection, enonce, photos: photosPourServeur(), blocs: blocsPourServeur() }, {
        message: texte,
        cibles: cible ? [cible.empreinte] : [],
        zone_traits: zoneIds,
        historique,
        annotations_actuelles: annotationsActuelles(),
        precisions: precisionsPourServeur(),
      });
    } finally {
      reseau--;
    }
    ajouterUsage(rep.tentatives);
    afficherUsage();
    if (zoneMontree) {
      zoneMontree = false;
      clearSelection();
    }
    if (appliquerReprise(rep, store.traits)) {
      notes.reconstruire();
      renderAnnotations();
      refreshAnnotationsBtn();
    }
    await ecrireExplications(rep);
    return rep.message;
  },
  onMontrerZone() {
    outil = 'lasso';
    toolbar.setTool(outil);
    clearSelection();
    zoneMontree = true;
    toolbar.toast('Entoure la zone à montrer au tuteur', 4000);
  },
  onAnnulerZone() {
    zoneMontree = false;
    clearSelection();
  },
  onPhotos() {
    selectionnerPhoto(null);
    updateHeight();
    fullRender();
  },
  onPlacerPhoto(photo: Photo) {
    if (photo.pos) {
      definirPos(photo.id, undefined);
      selectionnerPhoto(null);
      fullRender();
      toolbar.toast('Photo retirée de la feuille', 2000);
      return;
    }
    // Posée en haut de la zone visible, sous les yeux ; l'élève la déplace ensuite.
    const l = Math.min(520, LARGEUR_FEUILLE * 0.65);
    const [, haut] = viewport.toSheet(0, 90);
    definirPos(photo.id, { x: (LARGEUR_FEUILLE - l) / 2, y: Math.max(0, haut), l });
    fermerResultats();
    updateHeight();
    fullRender();
    selectionnerPhoto(photo.id);
    toolbar.toast('Déplace la photo, tire un coin pour la redimensionner, puis OK', 5000);
  },
  async onRepondre(item, texte) {
    if (!item.empreinte) throw new ErreurReco('cette annotation date d\u2019avant : touche « Corriger »');
    ajouterPrecision(item.empreinte, texte); // retenue tant que la ligne n'est pas réécrite
    reseau++;
    let rep;
    try {
      rep = await discuter(versFeuilleLegere(store.traits, fond, enonce), { ...reglagesCorrection, enonce, photos: photosPourServeur(), blocs: blocsPourServeur() }, {
        precision: { empreinte: item.empreinte, texte, lu: item.lu, propose: item.propose },
        annotations_actuelles: annotationsActuelles(),
        precisions: precisionsPourServeur(),
      });
    } finally {
      reseau--;
    }
    ajouterUsage(rep.tentatives);
    afficherUsage();
    if (appliquerReprise(rep, store.traits)) {
      notes.reconstruire();
      renderAnnotations();
      refreshAnnotationsBtn();
    }
    await ecrireExplications(rep);
    return rep.message;
  },
  onEnonce(texte) {
    enonce = texte.slice(0, ENONCE_MAX);
    persister();
  },
});

function fermerResultats() {
  if (!resultats.visible && !cadre) return;
  resultats.masquer();
  cadre = null;
  updateSurligne();
}

/** Fait défiler la feuille pour que le groupe soit visible au-dessus du panneau. */
function centrerSur(g: GroupeLu) {
  const s = viewport.scale;
  const yEcran = viewport.ty + g.y0 * s;
  const bas = viewport.H * 0.55; // le panneau occupe le bas de l'écran
  if (yEcran < 80 || (g.y1 * s + viewport.ty) > bas) {
    viewport.ty = 80 - g.y0 * s;
    viewport.clamp();
    fullRender();
  }
}

let lectureEnCours = false;
async function corriger() {
  if (mode || lectureEnCours) return;
  if (!store.traits.some((t) => t.outil === 'stylo')) {
    toolbar.toast('Rien à lire : la feuille est vide');
    return;
  }
  // Zone « sélection » : seules les lignes entourées au lasso sont lues et corrigées.
  const zone = reglagesCorrection.zone;
  const zoneSel = zone === 'selection' ? selBounds() : null;
  if (zone === 'selection' && !zoneSel) {
    toolbar.toast('Zone « sélection » : entourez d’abord des lignes au lasso', 3500);
    return;
  }
  const traits = zone === 'selection' ? [...selection] : store.traits;
  // Correction partielle : les lignes déjà vues et inchangées gardent leur annotation (le serveur ne les refait pas).
  const dejaVues = zone === 'feuille' && reglagesCorrection.portee === 'modifiees' && annotationsEtat.vues?.length ? new Set(annotationsEtat.vues) : null;
  lectureEnCours = true;
  lectureFond.annuler();
  fermerResultats();
  toolbar.toast('Correction en cours…', 300_000);
  try {
    const res = await corrigerFeuille(versFeuilleLegere(traits, fond, enonce), { ...reglagesCorrection, enonce, photos: photosPourServeur(), blocs: blocsPourServeur(), precisions: precisionsPourServeur(), ...(dejaVues ? { deja_corrigees: [...dejaVues] } : {}) });
    ajouterUsage(res.tentatives);
    afficherUsage();
    if (res.rienDeNouveau) {
      toolbar.toast('Rien de nouveau depuis la dernière correction', 3000);
    } else if (res.groupes.length === 0 || (res.entree !== 'image' && res.groupes.every((g) => !g.latex))) {
      toolbar.toast('Rien à corriger sur la feuille');
    } else {
      toolbar.toast(res.erreurCorrection ? 'Correction impossible' : 'Correction terminée', 1500);
      if (!res.erreurCorrection) {
        const inchangees = dejaVues ? new Set((res.empreintes ?? res.groupes.map((g) => g.empreinte ?? '')).filter((e) => dejaVues.has(e))) : null;
        poserAnnotations(res, store.traits, zoneSel, inchangees);
        if (!zoneSel) elaguerPrecisions(new Set(res.empreintes ?? res.groupes.map((g) => g.empreinte ?? ''))); // une ligne réécrite oublie sa précision
        const parId = new Map(res.groupes.map((g) => [g.id, g]));
        const n = await poserExplications(
          (res.explications ?? []).flatMap((e) => {
            const g = parId.get(e.groupe);
            return g ? [{ texte: e.texte, bbox: [g.x0, g.y0, g.x1, g.y1] as [number, number, number, number] }] : [];
          }),
        );
        if (n) toolbar.toast(`Le tuteur a écrit ${n} explication${n > 1 ? 's' : ''} sur la page`, 3500);
        notes.reconstruire();
        renderAnnotations();
        refreshAnnotationsBtn();
      }
      resultats.afficher(res);
    }
  } catch (e) {
    toolbar.toast(e instanceof ErreurReco ? `Correction impossible : ${e.message}` : 'Correction impossible', 5000);
  } finally {
    lectureEnCours = false;
  }
}

// --- Barre d'outils ------------------------------------------------------
function clearSelection() {
  if (selection.size === 0) return;
  selection.clear();
  fullRender();
  if (zoneMontree) resultats.majZone(0);
}

function historique(fn: () => boolean) {
  if (mode) return;
  if (!fn()) return;
  selection.clear();
  updateHeight();
  fullRender();
}

const toolbar = createToolbar({
  onTool(o) {
    if (mode) return;
    outil = o;
    toolbar.setTool(o);
    clearSelection();
  },
  onStyle(s) {
    if (mode) return;
    Object.assign(style, s);
    toolbar.setStyle(style.couleur, style.epaisseur);
    // Choisir une couleur ou une épaisseur ramène au stylo.
    outil = 'stylo';
    toolbar.setTool(outil);
    clearSelection();
  },
  onCorriger: () => void corriger(),
  onReglagesCorrection(r) {
    Object.assign(reglagesCorrection, r);
    toolbar.setCorrection(reglagesCorrection);
    try {
      localStorage.setItem(CORRECTION_KEY, JSON.stringify(reglagesCorrection));
    } catch {
      /* ignoré */
    }
  },
  onEnonce: () => resultats.ouvrirEnonce(),
  onPages: () => listePagesUi.basculer(),
  onCours: () => coursUi.basculer(),
  onDiscuter: () => resultats.ouvrirDiscussion(),
  onAnnotationsBasculer() {
    basculerVisibilite();
    notes.reconstruire();
    renderAnnotations();
    refreshAnnotationsBtn();
    toolbar.toast(annotationsEtat.visibles ? 'Annotations affichées' : 'Annotations masquées', 1200);
  },
  onAnnotationsEffacer() {
    effacerAnnotations();
    fermerResultats();
    notes.reconstruire();
    renderAnnotations();
    refreshAnnotationsBtn();
    toolbar.toast('Annotations effacées', 1500);
  },
  onFond(f) {
    fond = f;
    setFond(page, f);
    updatePage(page, viewport);
    toolbar.setFond(f);
    sauver();
  },
  onGribouille(actif) {
    gribouille = actif;
    try {
      localStorage.setItem(GRIBOUILLE_KEY, actif ? '1' : '0');
    } catch {
      /* ignoré */
    }
  },
  onFormes(actif) {
    formes = actif;
    try {
      localStorage.setItem(FORMES_KEY, actif ? '1' : '0');
    } catch {
      /* ignoré */
    }
  },
  async onImport(fichier) {
    try {
      const brut: unknown = JSON.parse(await fichier.text());
      const f = lireFeuille(brut);
      const photosImportees = (brut as { photos?: unknown }).photos;
      if (Array.isArray(photosImportees)) {
        remplacerPhotos(photosImportees);
        resultats.majPhotos();
      }
      const blocsImportes = (brut as { blocs?: unknown }).blocs;
      if (Array.isArray(blocsImportes)) remplacerBlocs(blocsImportes);
      store.remplacer(f.traits); // annulable avec ↶
      fond = f.fond;
      enonce = f.enonce ?? '';
      resultats.setEnonce(enonce);
      setFond(page, fond);
      toolbar.setFond(fond);
      selection.clear();
      viewport.ty = 0;
      updateHeight();
      fullRender();
      sauver();
      toolbar.toast(`Feuille importée (${f.traits.length} traits)`);
    } catch (e) {
      toolbar.toast(`Import impossible : ${e instanceof Error ? e.message : e}`);
    }
  },
  onExport() {
    const json = JSON.stringify({ ...versFeuille(store.traits, fond, enonce), ...(listePhotos().length ? { photos: listePhotos() } : {}), ...(listeBlocs().length ? { blocs: listeBlocs() } : {}) }, null, 2);
    console.log(json);
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([json], { type: 'application/json' })),
      download: `${pageCourante().nom.replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'feuille'}.json`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  },
  onUndo: () => historique(() => store.undo()),
  onRedo: () => historique(() => store.redo()),
  onDelete() {
    if (mode || selection.size === 0) return;
    store.removeMany([...selection]);
    selection.clear();
    updateHeight();
    fullRender();
  },
});
toolbar.setTool(outil);
toolbar.setStyle(style.couleur, style.epaisseur);
toolbar.setFond(fond);
toolbar.setGribouille(gribouille);
toolbar.setFormes(formes);
toolbar.setCorrection(reglagesCorrection);

// --- Cours (généré par Claude, global à l'appareil) -------------------------------
const coursUi = createCours({
  photos: photosPourServeur,
  onOuvrir() {
    fermerResultats();
    listePagesUi.fermer();
  },
  onCoursCree: (c) => void ouvrirPageCours(c.id),
  onOuvrirPage: (c) => void ouvrirPageCours(c.id),
  onExercicesAjoutes: (c, nouveaux, sections) => void ajouterAuCours(c.id, nouveaux, sections),
});

/** Écrit des blocs en bas de la page courante et renvoie ceux qui ont été créés. */
async function ecrireBlocs(brouillons: BrouillonBloc[]): Promise<Bloc[]> {
  const crees = await ajouterEnBas(brouillons, contenuBas());
  updateHeight();
  fullRender();
  return crees;
}

/** Fait défiler la feuille pour que le haut du bloc soit visible. */
function montrerBloc(b: Bloc) {
  viewport.ty = 90 - b.y * viewport.scale;
  viewport.clamp();
  fullRender();
}

/** Ouvre la page du cours ; si elle n'existe pas encore (nouveau cours), la crée et y écrit le cours à la main. */
async function ouvrirPageCours(id: string) {
  const c = trouverCours(id);
  if (!c) return;
  coursUi.fermer();
  if (c.pageId && pageExiste(c.pageId)) {
    if (c.pageId !== pageCourante().id) await ouvrirPage(c.pageId);
    return;
  }
  const ok = await changerDePage(() => {
    const p = creerPage(`Cours · ${c.titre}`, c.id);
    definirPageCours(c.id, p.id);
  });
  if (!ok) return;
  const crees = await ecrireBlocs(blocsDuCours(c));
  viewport.ty = 0;
  fullRender();
  toolbar.toast(crees.length ? 'Cours écrit sur la page : touche un exercice pour l\u2019indice, la solution ou plus de place' : 'Page créée', 4500);
}

/** Demande écrite : les exercices (et sections) nouveaux s'écrivent en bas de la page du cours. */
async function ajouterAuCours(id: string, nouveaux: Exercice[], sections?: SectionCours[]) {
  const c = trouverCours(id);
  if (!c) return;
  if (!c.pageId || !pageExiste(c.pageId)) return ouvrirPageCours(id); // pas encore de page : on écrit le cours entier (nouveautés comprises)
  coursUi.fermer();
  if (c.pageId !== pageCourante().id && !(await ouvrirPage(c.pageId))) return;
  const brouillons: BrouillonBloc[] = [];
  if (sections?.length) brouillons.push({ type: 'section', texte: 'Cours complété', coursId: id }, ...blocsSections(id, sections));
  if (nouveaux.length) brouillons.push({ type: 'section', texte: 'Exercices supplémentaires', coursId: id }, ...blocsNouveauxExercices(c, nouveaux));
  const crees = await ecrireBlocs(brouillons);
  if (crees[0]) montrerBloc(crees[0]);
  toolbar.toast(nouveaux.length ? `${nouveaux.length} exercice${nouveaux.length > 1 ? 's' : ''} ajouté${nouveaux.length > 1 ? 's' : ''} en bas de la page` : 'Cours complété en bas de la page', 3500);
}

/** Consommation de Claude de la page courante, en haut du menu réglages. */
function afficherUsage() {
  toolbar.setUsage(`Crédits utilisés · ${pageCourante().nom}`, resumeUsage(usageCourant()));
}

// --- Pages du cahier -------------------------------------------------------
const listePagesUi = createPages({
  onNouvelle: () => void nouvellePage(),
  onOuvrir: (id) => void ouvrirPage(id),
  onRenommer: renommerPage,
  onSupprimer: (id) => void retirerPage(id),
});

/** Charge la page courante (feuille, annotations, précisions, discussion) ; une page sans données donne une page vierge. */
async function chargerPageCourante() {
  resultats.reinitialiser();
  const sauvegarde = await charger();
  store.charger(sauvegarde?.traits ?? []);
  fond = sauvegarde?.fond ?? 'blanc';
  enonce = sauvegarde?.enonce ?? '';
  resultats.setEnonce(enonce);
  setFond(page, fond);
  toolbar.setFond(fond);
  await chargerAnnotations();
  await chargerPrecisions();
  await chargerConversation();
  await chargerPhotos();
  await chargerBlocs();
  selectionnerBloc(null);
  await chargerUsage();
  afficherUsage();
  resultats.majPhotos();
  selection.clear();
  zoneMontree = false;
  viewport.ty = 0;
  updateHeight();
  reevaluer(store.traits); // la feuille a pu changer depuis (import, autre session)
  notes.reconstruire();
  refreshAnnotationsBtn();
  fullRender();
}

/** Une opération réseau (correction, discussion) écrit dans la page où elle a démarré : pas de changement de page pendant ce temps. */
let reseau = 0;
function pageOccupee(): boolean {
  if (mode || lectureEnCours || reseau > 0) {
    toolbar.toast('Attends la fin de la correction ou de la discussion en cours', 3000);
    return true;
  }
  return false;
}

async function changerDePage(action: () => void | Promise<void>): Promise<boolean> {
  if (pageOccupee()) return false;
  await sauverMaintenant(); // enregistre la page quittée avant de changer de clé
  lectureFond.annuler();
  fermerResultats();
  await action();
  await chargerPageCourante();
  toolbar.toast(pageCourante().nom, 1500);
  return true;
}

const nouvellePage = () => changerDePage(() => void creerPage());
const ouvrirPage = (id: string) => changerDePage(() => choisirPage(id));

async function retirerPage(id: string) {
  if (id === pageCourante().id) {
    if (pageOccupee()) return;
    await sauverMaintenant();
    const suivante = await supprimerPage(id);
    if (suivante) {
      lectureFond.annuler();
      fermerResultats();
      await chargerPageCourante();
      toolbar.toast('Page supprimée', 1500);
    }
  } else {
    await supprimerPage(id);
    toolbar.toast('Page supprimée', 1500);
  }
}

// Rouvrir l'app retrouve le cahier, à la dernière page ouverte.
await chargerPages();
await chargerCours();
await chargerPageCourante();
demanderStockageDurable();

// Service worker : une mise à jour n'est appliquée que quand l'app passe en arrière-plan.
const majSW = registerSW({
  onNeedRefresh() {
    const appliquer = () => {
      if (document.hidden) void majSW(true);
    };
    document.addEventListener('visibilitychange', appliquer);
  },
});

window.addEventListener('resize', resize);
resize();

// --- Doigts : défilement et zoom ---------------------------------------
const touch = setupTouch(root, viewport, {
  onChange: scheduleSync,
  onEnd() {
    // Fin du geste : rendu propre, la transformation CSS est retirée dans la même frame.
    cancelAnimationFrame(raf);
    raf = 0;
    fullRender();
  },
  log,
});

// --- Toucher une annotation (doigt) ---------------------------------------
// Un appui bref et immobile sur une note, un cercle ou une coche ouvre son détail dans le panneau.
const APPUI_MAX_MS = 700; // un appui franc, pas un geste de défilement ou de zoom
const APPUI_MAX_PX = 18; // tolérance de glissement du doigt pendant l'appui
const CONTACT_PAUME = 115; // même seuil que le rejet de paume (input/touch.ts) : un gros doigt n'est pas une paume
let appui: { id: number; x: number; y: number; t: number } | null = null;
root.addEventListener('pointerdown', (e) => {
  const paume = e.width > CONTACT_PAUME || e.height > CONTACT_PAUME;
  appui = e.pointerType === 'touch' && e.isPrimary && !paume ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp } : null;
});
root.addEventListener('pointercancel', () => (appui = null));
root.addEventListener('pointerup', (e) => {
  const a = appui;
  appui = null;
  if (e.pointerType !== 'touch') return;
  if (!a || a.id !== e.pointerId || mode) {
    log(`appui ignoré (${a ? 'stylet en cours' : 'contact refusé'}) ${e.width.toFixed(0)}x${e.height.toFixed(0)}`);
    return;
  }
  const dist = Math.hypot(e.clientX - a.x, e.clientY - a.y);
  const duree = e.timeStamp - a.t;
  if (dist > APPUI_MAX_PX || duree > APPUI_MAX_MS) {
    log(`appui ignoré : ${dist.toFixed(0)} px, ${duree.toFixed(0)} ms`);
    return;
  }
  const item = notes.trouver(e.clientX, e.clientY, viewport);
  log(`appui ${dist.toFixed(0)} px, ${duree.toFixed(0)} ms : ${item ? `annotation ${item.groupe}` : 'aucune annotation ici'}`);
  if (item) {
    resultats.detail(item);
    return;
  }
  // Appui sur une photo posée sur la feuille : elle s'affiche avec son cadre (déplacer, redimensionner, recadrer) ; ailleurs, désélection.
  const [sx, sy] = viewport.toSheet(e.clientX, e.clientY);
  const photo = photosFeuille.trouver(listePhotos(), sx, sy);
  const bloc = photo ? null : blocsFeuille.trouver(listeBlocs(), sx, sy);
  selectionnerPhoto(photo?.id ?? null);
  selectionnerBloc(bloc?.id ?? null);
});

// --- Stylet --------------------------------------------------------------
type Mode = 'stylo' | 'gomme' | 'lasso' | 'deplacer';
let mode: Mode | null = null;
let courant: Trait | null = null; // trait de stylo en cours
let predits: Point[] = [];
let lasso: [number, number][] = [];
let gommePos: [number, number] = [0, 0];
let depart: [number, number] = [0, 0];
let liveRaf = 0;
let penId = -1;
/** Forme reconnue pendant le maintien ; l'extrémité suit ensuite le stylet. */
let forme: { f: Forme; a: [number, number]; pression: number; t0: number } | null = null;
let ancre: [number, number] = [0, 0]; // position écran du début du maintien
let maintien = 0;

function armerMaintien() {
  clearTimeout(maintien);
  if (formes && mode === 'stylo' && !forme) maintien = window.setTimeout(figer, MAINTIEN_MS);
}

function figer() {
  if (!formes || mode !== 'stylo' || !courant || forme) return;
  const f = reconnaitre(courant.points);
  if (!f) return;
  const pts = courant.points;
  const a: [number, number] = [pts[0][0], pts[0][1]];
  const b = pts[pts.length - 1];
  const pression = pts.reduce((s, p) => s + p[2], 0) / pts.length;
  forme = { f, a, pression, t0: pts[0][3] };
  courant.points = genere(f, a, [b[0], b[1]], pression, pts[0][3], b[3]);
  predits = [];
  log(`forme: ${f.type}`);
  scheduleLive();
}

function toPoint(e: PointerEvent): Point {
  const [x, y] = viewport.toSheet(e.clientX, e.clientY);
  // Certains stylets renvoient 0 au contact initial : valeur par défaut raisonnable.
  return [x, y, e.pressure > 0 ? e.pressure : 0.5, Math.round(e.timeStamp + performance.timeOrigin)];
}

function drawLive() {
  liveRaf = 0;
  live.clear();
  if (!mode) return;
  live.applyViewport(viewport);
  const ctx = live.ctx;
  const s = viewport.scale;
  if (mode === 'stylo' && courant) {
    drawLiveStroke(ctx, [...courant.points, ...predits], courant.couleur, courant.epaisseur);
  } else if (mode === 'lasso' && lasso.length > 1) {
    ctx.beginPath();
    ctx.moveTo(lasso[0][0], lasso[0][1]);
    for (const [x, y] of lasso) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(42, 107, 255, 0.08)';
    ctx.fill();
    ctx.setLineDash([6 / s, 4 / s]);
    ctx.lineWidth = 1.5 / s;
    ctx.strokeStyle = '#2a6bff';
    ctx.stroke();
  } else if (mode === 'gomme') {
    ctx.beginPath();
    ctx.arc(gommePos[0], gommePos[1], GOMME_PX / s, 0, Math.PI * 2);
    ctx.lineWidth = 1 / s;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.stroke();
  } else if (mode === 'deplacer') {
    renderInk();
    updateSelBox();
  }
}

function scheduleLive() {
  if (!liveRaf) liveRaf = requestAnimationFrame(drawLive);
}

function efface(from: [number, number], to: [number, number]) {
  const hits = sweepHits(store.traits, hidden, from, to, GOMME_PX / viewport.scale);
  if (hits.length === 0) return;
  for (const t of hits) hidden.add(t);
  renderInk();
}

function dansSelection(x: number, y: number): boolean {
  const b = selBounds();
  const marge = 12 / viewport.scale;
  return !!b && x >= b.x0 - marge && x <= b.x1 + marge && y >= b.y0 - marge && y <= b.y1 + marge;
}

root.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'pen') return;
  e.preventDefault();
  if (cadrePhoto.idSelectionne) selectionnerPhoto(null); // le stylet recommence à écrire : on quitte l'édition de la photo ou du bloc
  if (cadreBloc.idSelectionne) selectionnerBloc(null);
  finir(); // un geste resté ouvert (pointerup perdu) ne doit jamais bloquer le suivant
  touch.setPen(true); // annule tout défilement/zoom en cours
  penId = e.pointerId;
  try {
    root.setPointerCapture(e.pointerId);
  } catch {
    /* ne doit jamais empêcher le tracé */
  }
  const p = toPoint(e);
  log(`stylo ${outil} p=${e.pressure.toFixed(2)}`);

  if (outil === 'stylo') {
    clearSelection();
    mode = 'stylo';
    courant = {
      id: nouvelId(),
      couleur: style.couleur,
      epaisseur: style.epaisseur,
      outil: 'stylo',
      debut: p[3],
      fin: p[3],
      points: [p],
    };
    predits = [];
    forme = null;
    ancre = [e.clientX, e.clientY];
    armerMaintien();
  } else if (outil === 'gomme') {
    mode = 'gomme';
    gommePos = [p[0], p[1]];
    efface(gommePos, gommePos);
  } else if (selection.size > 0 && dansSelection(p[0], p[1])) {
    mode = 'deplacer';
    depart = [p[0], p[1]];
    drag.dx = drag.dy = 0;
  } else {
    clearSelection();
    mode = 'lasso';
    lasso = [[p[0], p[1]]];
  }
  scheduleLive();
});

root.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'pen' || !mode || e.pointerId !== penId) return;
  e.preventDefault();
  const reels = e.getCoalescedEvents?.() ?? [];
  for (const ce of reels.length ? reels : [e]) {
    const p = toPoint(ce);
    if (mode === 'stylo' && courant && forme) {
      // Forme figée : seule l'extrémité suit le stylet.
      courant.points = genere(forme.f, forme.a, [p[0], p[1]], forme.pression, forme.t0, p[3]);
      courant.fin = p[3];
    } else if (mode === 'stylo' && courant) {
      courant.points.push(p);
      courant.fin = p[3];
      if (Math.hypot(ce.clientX - ancre[0], ce.clientY - ancre[1]) > MAINTIEN_PX) {
        ancre = [ce.clientX, ce.clientY];
        armerMaintien();
      }
    } else if (mode === 'gomme') {
      const to: [number, number] = [p[0], p[1]];
      efface(gommePos, to);
      gommePos = to;
    } else if (mode === 'lasso') {
      lasso.push([p[0], p[1]]);
    } else if (mode === 'deplacer') {
      drag.dx = p[0] - depart[0];
      drag.dy = p[1] - depart[1];
    }
  }
  // Points prédits : affichés seulement, jamais enregistrés.
  predits = USE_PREDICTED && mode === 'stylo' ? (e.getPredictedEvents?.() ?? []).map(toPoint) : [];
  scheduleLive();
});

function finir() {
  if (!mode) return;
  const m = mode;
  mode = null;
  clearTimeout(maintien);
  predits = [];
  live.clear();
  if (m === 'stylo' && courant) {
    const t = courant;
    courant = null;
    const raye = gribouille && !forme ? trouverCibles(t, store.traits) : [];
    if (raye.length > 0) {
      // Gribouillis : il efface ce qu'il raye et ne laisse pas de trace.
      store.removeMany(raye);
      updateHeight();
      fullRender();
      touch.setPen(false);
      return;
    }
    forme = null;
    store.add(t);
    const grandit = bboxOf(t).y1 + MARGE_BAS > viewport.sheetH;
    encre.applyViewport(rendered);
    drawTrait(encre.ctx, t);
    if (grandit) {
      updateHeight();
      updatePage(page, viewport);
    }
    refreshToolbar();
  } else if (m === 'gomme') {
    const ts = [...hidden];
    hidden.clear();
    store.removeMany(ts);
    updateHeight();
    fullRender();
  } else if (m === 'lasso') {
    for (const t of selectInside(store.traits, lasso)) selection.add(t);
    lasso = [];
    fullRender();
    if (zoneMontree) resultats.majZone(selection.size);
  } else if (m === 'deplacer') {
    const { dx, dy } = drag;
    drag.dx = drag.dy = 0;
    if (dx !== 0 || dy !== 0) store.moveMany([...selection], dx, dy);
    updateHeight();
    fullRender();
  }
  touch.setPen(false);
}

for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
  root.addEventListener(ev, (e) => {
    // lostpointercapture arrive en différé : celui de l'ancien trait ne doit pas terminer le nouveau.
    const pe = e as PointerEvent;
    if (pe.pointerType === 'pen' && pe.pointerId === penId) {
      if (mode) log(`${ev} (${mode}, ${courant?.points.length ?? 0} pts)`);
      finir();
    }
  });
}
// Safari peut interpréter deux appuis rapprochés comme un double-tap et avaler le geste :
// on neutralise ses gestes tactiles par défaut (les pointer events ne sont pas affectés).
for (const ev of ['touchstart', 'touchmove', 'dblclick', 'click']) {
  root.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}
window.addEventListener('blur', finir);
document.addEventListener('visibilitychange', finir);
