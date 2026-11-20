import type { Fond, Outil } from '../model';

export const COULEURS = ['#111111', '#1a56db', '#d92d20', '#16a34a', '#eab308', '#f97316', '#7c3aed', '#0891b2'] as const;
export const EPAISSEURS = [1.6, 3.4] as const;

/** Réglages de la correction (voir reco.ts : envoyés au serveur). */
export interface ReglagesCorrection {
  mode: 'tout' | 'sans_solution' | 'indice' | 'resultat_final';
  zone: 'feuille' | 'selection';
  ton: 'bref' | 'detaille';
  /** modifiees = seules les lignes nouvelles ou réécrites depuis la dernière correction ; toutes = tout revérifier. */
  portee: 'modifiees' | 'toutes';
}

export interface ToolbarHooks {
  onTool(o: Outil): void;
  onStyle(s: { couleur?: string; epaisseur?: number }): void;
  onUndo(): void;
  onRedo(): void;
  onDelete(): void;
  onCorriger(): void;
  onReglagesCorrection(r: Partial<ReglagesCorrection>): void;
  onEnonce(): void;
  onPages(): void;
  onCours(): void;
  onDiscuter(): void;
  onAnnotationsBasculer(): void;
  onAnnotationsEffacer(): void;
  onFond(f: Fond): void;
  onExport(): void;
  onImport(fichier: File): void;
  onGribouille(actif: boolean): void;
  onFormes(actif: boolean): void;
}

/** Engrenage à 8 dents. */
function engrenage(): string {
  const pts: string[] = [];
  const pol = (r: number, deg: number) => `${(12 + r * Math.cos((deg * Math.PI) / 180)).toFixed(2)},${(12 + r * Math.sin((deg * Math.PI) / 180)).toFixed(2)}`;
  for (let k = 0; k < 8; k++) {
    const c = k * 45;
    pts.push(pol(7, c - 14), pol(9.6, c - 9), pol(9.6, c + 9), pol(7, c + 14));
  }
  return `<polygon points="${pts.join(' ')}"/><circle cx="12" cy="12" r="3"/>`;
}

const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONES = {
  stylo: svg('<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z"/><path d="M14.5 6.5l3 3"/>'),
  gomme: svg('<path d="M20 20H9L4 15a2 2 0 010-2.8l8-8a2 2 0 012.8 0l5 5a2 2 0 010 2.8L13 19"/><path d="M8 9l7 7"/>'),
  lasso: svg('<path d="M12 5c-5 0-8 2-8 4.5S7 14 12 14s8-2 8-4.5S17 5 12 5z" stroke-dasharray="3 2.5"/><path d="M9 14c-1 2 0 5 3 5"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>'),
  redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/>'),
  corriger: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  reglages: svg(engrenage()),
  discuter: svg('<path d="M4 5h16v11H10l-5 4v-4H4z"/><path d="M8 9.5h8M8 12.5h5"/>'),
  enonce: svg('<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4M10 12h6M10 16h6"/>'),
  cours: svg('<path d="M5 4h10a3 3 0 013 3v13H8a3 3 0 01-3-3z"/><path d="M5 17a3 3 0 013-3h10"/>'),
  pages: svg('<path d="M8 3h10v14H8z"/><path d="M5 7v14h10"/>'),
  oeil: svg('<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  oeilBarre: svg('<path d="M3 3l18 18"/><path d="M10.6 6a9.6 9.6 0 011.4-.1c6.4 0 10 6.1 10 6.1a17 17 0 01-3.2 3.9M6.4 7.7A17 17 0 002 12s3.6 6.5 10 6.5a9.7 9.7 0 004-.9"/><path d="M9.9 10a3 3 0 004.1 4.1"/>'),
  suppr: svg('<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>'),
  poignee: svg('<circle cx="9" cy="7" r="1.2"/><circle cx="15" cy="7" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="17" r="1.2"/><circle cx="15" cy="17" r="1.2"/>'),
};

const POS_KEY = 'tutorat.toolbar';

/** Petite barre flottante, repositionnable (on la déplace par la poignée). */
export function createToolbar(hooks: ToolbarHooks) {
  const bar = Object.assign(document.createElement('div'), { id: 'toolbar' });
  const sep = () => bar.appendChild(Object.assign(document.createElement('span'), { className: 'sep' }));
  const btn = (html: string, label: string, fn: () => void, cls = '') => {
    const b = document.createElement('button');
    b.innerHTML = html;
    b.setAttribute('aria-label', label);
    if (cls) b.className = cls;
    b.addEventListener('click', fn);
    bar.appendChild(b);
    return b;
  };

  // Poignée de déplacement.
  const poignee = Object.assign(document.createElement('div'), { className: 'poignee', innerHTML: ICONES.poignee });
  bar.appendChild(poignee);

  const tools: Record<Outil, HTMLButtonElement> = {
    stylo: btn(ICONES.stylo, 'Stylo', () => hooks.onTool('stylo')),
    gomme: btn(ICONES.gomme, 'Gomme', () => hooks.onTool('gomme')),
    lasso: btn(ICONES.lasso, 'Lasso', () => hooks.onTool('lasso')),
  };
  sep();
  const couleurBtn = btn('', 'Couleur', () => {
    menu.classList.remove('ouvert');
    palette.style.left = `${couleurBtn.offsetLeft}px`;
    palette.classList.toggle('ouvert');
  }, 'pastille');
  const palette = Object.assign(document.createElement('div'), { className: 'palette' });
  const pastilles = COULEURS.map((c) => {
    const b = document.createElement('button');
    b.className = 'pastille';
    b.setAttribute('aria-label', 'Couleur');
    b.style.setProperty('--c', c);
    b.addEventListener('click', () => {
      palette.classList.remove('ouvert');
      hooks.onStyle({ couleur: c });
    });
    palette.appendChild(b);
    return b;
  });
  const epaisseurs = EPAISSEURS.map((e, i) => {
    const b = btn('', 'Épaisseur', () => hooks.onStyle({ epaisseur: e }), 'trait');
    b.style.setProperty('--h', `${2 + i * 3}px`);
    return b;
  });
  sep();
  const undo = btn(ICONES.undo, 'Annuler', hooks.onUndo);
  const redo = btn(ICONES.redo, 'Rétablir', hooks.onRedo);
  const del = btn(ICONES.suppr, 'Supprimer la sélection', hooks.onDelete);
  sep();
  btn(ICONES.pages, 'Pages', hooks.onPages).dataset.pagesBtn = '';
  btn(ICONES.cours, 'Cours', hooks.onCours);
  btn(ICONES.discuter, 'Discuter avec le tuteur', hooks.onDiscuter);
  btn(ICONES.enonce, 'Énoncé', hooks.onEnonce);
  const annotationsBtn = btn(ICONES.oeil, 'Masquer ou afficher les annotations', hooks.onAnnotationsBasculer);
  annotationsBtn.style.display = 'none';
  btn(ICONES.corriger + '<span>Corriger</span>', 'Corriger', hooks.onCorriger, 'corriger');
  const reglagesBtn = btn(ICONES.reglages, 'Réglages', () => {
    palette.classList.remove('ouvert');
    menu.classList.toggle('ouvert');
  });

  // Menu des réglages.
  const menu = Object.assign(document.createElement('div'), { className: 'menu' });
  const fonds: [Fond, string][] = [['blanc', 'Blanc'], ['carreaux', 'Carreaux'], ['ligne', 'Ligné']];
  const fondBtns = fonds.map(([f, nom]) => {
    const b = Object.assign(document.createElement('button'), { textContent: nom });
    b.addEventListener('click', () => hooks.onFond(f));
    return [f, b] as const;
  });
  const rangee = Object.assign(document.createElement('div'), { className: 'fonds' });
  rangee.append(...fondBtns.map(([, b]) => b));
  const creerBascule = (nom: string, onChange: (actif: boolean) => void) => {
    let actif = true;
    const el = Object.assign(document.createElement('button'), { className: 'bascule' });
    const maj = () => {
      el.textContent = `${nom} : ${actif ? 'oui' : 'non'}`;
      el.classList.toggle('actif', actif);
    };
    el.addEventListener('click', () => {
      actif = !actif;
      maj();
      onChange(actif);
    });
    maj();
    return {
      el,
      set(v: boolean) {
        actif = v;
        maj();
      },
    };
  };
  /** Choix exclusif présenté en boutons (grille à `colonnes` colonnes). */
  const creerChoix = <T extends string>(titre: string, options: [T, string][], onChange: (v: T) => void, colonnes = 2) => {
    const el = Object.assign(document.createElement('div'), { className: 'choix' });
    const grille = Object.assign(document.createElement('div'), { className: 'grille' });
    grille.style.gridTemplateColumns = `repeat(${colonnes}, 1fr)`;
    const boutons = options.map(([v, nom]) => {
      const b = Object.assign(document.createElement('button'), { textContent: nom });
      b.addEventListener('click', () => onChange(v));
      return [v, b] as const;
    });
    grille.append(...boutons.map(([, b]) => b));
    el.append(Object.assign(document.createElement('div'), { textContent: titre, className: 'titre' }), grille);
    return { el, set: (v: T) => boutons.forEach(([k, b]) => b.classList.toggle('actif', k === v)) };
  };
  const choixMode = creerChoix<ReglagesCorrection['mode']>(
    'Correction : mode',
    [['tout', 'Tout corriger'], ['sans_solution', 'Erreurs sans solution'], ['indice', 'Un indice seulement'], ['resultat_final', 'Résultat final']],
    (mode) => hooks.onReglagesCorrection({ mode }),
  );
  const choixZone = creerChoix<ReglagesCorrection['zone']>(
    'Zone',
    [['feuille', 'Toute la feuille'], ['selection', 'Sélection (lasso)']],
    (zone) => hooks.onReglagesCorrection({ zone }),
  );
  const choixPortee = creerChoix<ReglagesCorrection['portee']>(
    'Lignes corrigées',
    [['modifiees', 'Nouvelles ou modifiées'], ['toutes', 'Tout revérifier']],
    (portee) => hooks.onReglagesCorrection({ portee }),
  );
  const choixTon = creerChoix<ReglagesCorrection['ton']>('Ton des notes', [['bref', 'Bref'], ['detaille', 'Détaillé']], (ton) => hooks.onReglagesCorrection({ ton }));
  const gribouille = creerBascule('Gribouiller pour effacer', hooks.onGribouille);
  const formes = creerBascule('Maintenir pour redresser', hooks.onFormes);
  const exporter = Object.assign(document.createElement('button'), { textContent: 'Exporter le JSON', className: 'export' });
  exporter.addEventListener('click', () => {
    menu.classList.remove('ouvert');
    hooks.onExport();
  });
  const entree = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json,.json' });
  entree.style.display = 'none';
  entree.addEventListener('change', () => {
    const f = entree.files?.[0];
    entree.value = ''; // permet de réimporter le même fichier
    if (f) hooks.onImport(f);
  });
  const importer = Object.assign(document.createElement('button'), { textContent: 'Importer un JSON', className: 'export' });
  importer.addEventListener('click', () => {
    menu.classList.remove('ouvert');
    entree.click();
  });
  const effacerAnnotations = Object.assign(document.createElement('button'), { textContent: 'Effacer les annotations', className: 'export' });
  effacerAnnotations.addEventListener('click', () => {
    menu.classList.remove('ouvert');
    hooks.onAnnotationsEffacer();
  });
  // Consommation de Claude pour la page courante (tokens et coût équivalent), tout en haut du menu.
  const usageEl = Object.assign(document.createElement('div'), { className: 'usage' });
  menu.append(usageEl, Object.assign(document.createElement('div'), { textContent: 'Fond de page', className: 'titre' }), rangee, choixMode.el, choixZone.el, choixPortee.el, choixTon.el, gribouille.el, formes.el, exporter, importer, effacerAnnotations, entree);
  bar.append(menu, palette);

  // Un appui ailleurs referme le menu.
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as Node;
    if (menu.classList.contains('ouvert') && !menu.contains(t) && !reglagesBtn.contains(t)) menu.classList.remove('ouvert');
    if (palette.classList.contains('ouvert') && !palette.contains(t) && !couleurBtn.contains(t)) palette.classList.remove('ouvert');
  });

  const toast = Object.assign(document.createElement('div'), { id: 'toast' });
  document.body.append(bar, toast);

  // --- Position -----------------------------------------------------------
  function placer(x: number, y: number) {
    const r = bar.getBoundingClientRect();
    x = Math.min(window.innerWidth - r.width - 4, Math.max(4, x));
    y = Math.min(window.innerHeight - r.height - 4, Math.max(4, y));
    bar.style.left = `${x}px`;
    bar.style.top = `${y}px`;
    bar.classList.toggle('bas', y > window.innerHeight / 2);
    return [x, y];
  }
  let saved: [number, number] | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null');
  } catch {
    /* stockage indisponible : position par défaut */
  }
  placer(saved ? saved[0] : (window.innerWidth - bar.getBoundingClientRect().width) / 2, saved ? saved[1] : 10);
  window.addEventListener('resize', () => placer(parseFloat(bar.style.left), parseFloat(bar.style.top)));

  let decal: [number, number] | null = null;
  poignee.addEventListener('pointerdown', (e) => {
    poignee.setPointerCapture(e.pointerId);
    const r = bar.getBoundingClientRect();
    decal = [e.clientX - r.left, e.clientY - r.top];
  });
  poignee.addEventListener('pointermove', (e) => {
    if (decal) placer(e.clientX - decal[0], e.clientY - decal[1]);
  });
  const fin = () => {
    if (!decal) return;
    decal = null;
    try {
      localStorage.setItem(POS_KEY, JSON.stringify([parseFloat(bar.style.left), parseFloat(bar.style.top)]));
    } catch {
      /* ignoré */
    }
  };
  poignee.addEventListener('pointerup', fin);
  poignee.addEventListener('pointercancel', fin);

  let toastTimer = 0;
  return {
    setTool(o: Outil) {
      for (const [k, b] of Object.entries(tools)) b.classList.toggle('actif', k === o);
    },
    setStyle(couleur: string, epaisseur: number) {
      couleurBtn.style.setProperty('--c', couleur);
      COULEURS.forEach((c, i) => pastilles[i].classList.toggle('actif', c === couleur));
      EPAISSEURS.forEach((e, i) => epaisseurs[i].classList.toggle('actif', e === epaisseur));
    },
    setCorrection(r: ReglagesCorrection) {
      choixMode.set(r.mode);
      choixZone.set(r.zone);
      choixPortee.set(r.portee);
      choixTon.set(r.ton);
    },
    /** Texte de consommation de la page (voir usage.ts). */
    setUsage(titre: string, texte: string) {
      usageEl.replaceChildren(Object.assign(document.createElement('div'), { className: 'titre', textContent: titre }), Object.assign(document.createElement('div'), { className: 'valeur', textContent: texte }));
    },
    setGribouille: gribouille.set,
    setFormes: formes.set,
    setFond(f: Fond) {
      for (const [k, b] of fondBtns) b.classList.toggle('actif', k === f);
    },
    /** Le bouton œil n'apparaît que s'il y a des annotations ; l'icône dit si elles sont affichées. */
    setAnnotations(existent: boolean, visibles: boolean) {
      annotationsBtn.style.display = existent ? '' : 'none';
      annotationsBtn.innerHTML = visibles ? ICONES.oeil : ICONES.oeilBarre;
    },
    update(s: { canUndo: boolean; canRedo: boolean; selection: boolean }) {
      undo.disabled = !s.canUndo;
      redo.disabled = !s.canRedo;
      del.style.display = s.selection ? '' : 'none';
    },
    toast(msg: string, ms = 2200) {
      toast.textContent = msg;
      toast.classList.add('visible');
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toast.classList.remove('visible'), ms);
    },
  };
}
