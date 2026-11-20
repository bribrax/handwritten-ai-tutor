import type { Photo } from '../photos';

export interface VisionneuseHooks {
  /** Applique le cadrage (pixels de la photo) ; la visionneuse affiche ensuite la photo recadrée. */
  onRecadrer(photo: Photo, x: number, y: number, w: number, h: number): Promise<Photo>;
  onSupprimer(photo: Photo): void;
  /** Pose la photo sur la feuille, ou l'en retire si elle y est déjà ; la visionneuse se ferme ensuite. */
  onPlacer?(photo: Photo): void;
}

export interface OptionsVisionneuse {
  /** Ouvre directement le cadrage (depuis le cadre d'édition sur la feuille). */
  recadrerDirect?: boolean;
}

const ECHELLE_MAX = 10; // × l'échelle d'ajustement
const TAILLE_MIN = 24; // côté minimal du cadrage, en pixels de la photo

/**
 * Visionneuse plein écran : un doigt (ou le stylet) déplace la photo, deux doigts l'agrandissent, la molette aussi.
 * « Recadrer » affiche un cadre à poignées (déplaçable) ; « Appliquer » découpe la photo.
 */
export function ouvrirVisionneuse(depart: Photo, hooks: VisionneuseHooks, options: OptionsVisionneuse = {}): void {
  let photo = depart;
  const el = Object.assign(document.createElement('div'), { id: 'photo-vue' });
  const haut = Object.assign(document.createElement('div'), { className: 'barre' });
  const scene = Object.assign(document.createElement('div'), { className: 'scene' });
  const img = Object.assign(document.createElement('img'), { draggable: false, alt: "Photo de l'énoncé" });
  const cadreEl = Object.assign(document.createElement('div'), { className: 'cadre' });
  for (const h of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
    const poigneeEl = Object.assign(document.createElement('span'), { className: `poignee ${h}` });
    poigneeEl.dataset.h = h; // dataset est en lecture seule : on ne peut pas le passer à Object.assign
    cadreEl.append(poigneeEl);
  }
  scene.append(img, cadreEl);
  el.append(haut, scene);
  document.body.appendChild(el);

  const bouton = (texte: string, fn: () => void, cls = '') => {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: texte, className: cls });
    b.addEventListener('click', fn);
    return b;
  };

  // --- Vue : échelle s et décalage (tx, ty) de la photo à l'écran ---------------------------------------------------------
  let s = 1;
  let tx = 0;
  let ty = 0;
  let ajuste = 1;
  const taille = () => ({ W: scene.clientWidth, H: scene.clientHeight });

  function ajuster() {
    const { W, H } = taille();
    ajuste = Math.min(W / photo.w, H / photo.h) * 0.96;
    s = ajuste;
    tx = (W - photo.w * s) / 2;
    ty = (H - photo.h * s) / 2;
    appliquer();
  }

  function contraindre() {
    const { W, H } = taille();
    s = Math.min(ajuste * ECHELLE_MAX, Math.max(ajuste * 0.4, s));
    // La photo ne sort jamais complètement de l'écran.
    const marge = 60;
    tx = Math.min(W - marge, Math.max(marge - photo.w * s, tx));
    ty = Math.min(H - marge, Math.max(marge - photo.h * s, ty));
  }

  // --- Cadrage ----------------------------------------------------------------------------------------------------
  type Rogne = { x0: number; y0: number; x1: number; y1: number };
  let rogne: Rogne | null = null as Rogne | null;

  function appliquer() {
    contraindre();
    img.style.width = `${photo.w}px`;
    img.style.height = `${photo.h}px`;
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    if (rogne) {
      cadreEl.style.display = 'block';
      cadreEl.style.left = `${tx + rogne.x0 * s}px`;
      cadreEl.style.top = `${ty + rogne.y0 * s}px`;
      cadreEl.style.width = `${(rogne.x1 - rogne.x0) * s}px`;
      cadreEl.style.height = `${(rogne.y1 - rogne.y0) * s}px`;
    } else {
      cadreEl.style.display = 'none';
    }
  }

  function barre() {
    haut.replaceChildren();
    if (rogne) {
      haut.append(
        bouton('Annuler', () => {
          rogne = null;
          barre();
          appliquer();
        }),
        Object.assign(document.createElement('span'), { className: 'info', textContent: 'Déplace les poignées pour recadrer' }),
        bouton('Appliquer', () => void appliquerCadrage(), 'principal'),
      );
    } else {
      haut.append(
        bouton('Fermer', fermer),
        Object.assign(document.createElement('span'), { className: 'info', textContent: 'Glisse pour déplacer · pince pour agrandir' }),
        bouton('Ajuster', ajuster),
        ...(hooks.onPlacer
          ? [bouton(photo.pos ? 'Retirer de la feuille' : 'Placer sur la feuille', () => {
              hooks.onPlacer?.(photo);
              fermer();
            }, photo.pos ? '' : 'principal')]
          : []),
        bouton('Recadrer', () => {
          rogne = { x0: photo.w * 0.05, y0: photo.h * 0.05, x1: photo.w * 0.95, y1: photo.h * 0.95 };
          barre();
          appliquer();
        }),
        bouton('Supprimer', () => {
          if (confirm('Supprimer cette photo ?')) {
            hooks.onSupprimer(photo);
            fermer();
          }
        }, 'danger'),
      );
    }
  }

  async function appliquerCadrage() {
    if (!rogne) return;
    const r = rogne;
    try {
      photo = await hooks.onRecadrer(photo, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    } catch (e) {
      console.warn('Recadrage impossible', e);
      return;
    }
    rogne = null;
    img.src = photo.src;
    barre();
    ajuster();
  }

  function fermer() {
    document.removeEventListener('keydown', surTouche);
    window.removeEventListener('resize', ajuster);
    el.remove();
  }
  const surTouche = (e: KeyboardEvent) => {
    if (e.key === 'Escape') fermer();
  };

  // --- Gestes -----------------------------------------------------------------------------------------------------
  const pointeurs = new Map<number, { x: number; y: number }>();
  let geste: { dist: number; s: number; cx: number; cy: number } | null = null;
  let poignee: { h: string; depart: { x: number; y: number }; rogne: Rogne } | null = null;

  const posScene = (e: MouseEvent) => {
    const r = scene.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function debutGeste() {
    const [a, b] = [...pointeurs.values()];
    if (b) geste = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, s, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    else geste = null;
  }

  scene.addEventListener('pointerdown', (e) => {
    scene.setPointerCapture(e.pointerId);
    const p = posScene(e);
    const cible = e.target as HTMLElement;
    if (rogne && pointeurs.size === 0 && (cible.classList.contains('poignee') || cible === cadreEl)) {
      poignee = { h: cible.dataset.h ?? 'corps', depart: p, rogne: { ...rogne } };
      return;
    }
    pointeurs.set(e.pointerId, p);
    debutGeste();
  });

  scene.addEventListener('pointermove', (e) => {
    const p = posScene(e);
    if (poignee && rogne) {
      const dx = (p.x - poignee.depart.x) / s;
      const dy = (p.y - poignee.depart.y) / s;
      const o = poignee.rogne;
      const h = poignee.h;
      let { x0, y0, x1, y1 } = o;
      if (h === 'corps') {
        const w = o.x1 - o.x0;
        const ht = o.y1 - o.y0;
        x0 = Math.min(photo.w - w, Math.max(0, o.x0 + dx));
        y0 = Math.min(photo.h - ht, Math.max(0, o.y0 + dy));
        x1 = x0 + w;
        y1 = y0 + ht;
      } else {
        if (h.includes('w')) x0 = Math.min(o.x1 - TAILLE_MIN, Math.max(0, o.x0 + dx));
        if (h.includes('e')) x1 = Math.max(o.x0 + TAILLE_MIN, Math.min(photo.w, o.x1 + dx));
        if (h.includes('n')) y0 = Math.min(o.y1 - TAILLE_MIN, Math.max(0, o.y0 + dy));
        if (h.includes('s')) y1 = Math.max(o.y0 + TAILLE_MIN, Math.min(photo.h, o.y1 + dy));
      }
      rogne = { x0, y0, x1, y1 };
      appliquer();
      return;
    }
    const avant = pointeurs.get(e.pointerId);
    if (!avant) return;
    pointeurs.set(e.pointerId, p);
    if (pointeurs.size >= 2 && geste) {
      const [a, b] = [...pointeurs.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const nouveau = Math.min(ajuste * ECHELLE_MAX, Math.max(ajuste * 0.4, geste.s * (dist / geste.dist)));
      // Le point de la photo sous le centre du pincement le reste (zoom) et suit le déplacement du centre (pan).
      const px = (geste.cx - tx) / s;
      const py = (geste.cy - ty) / s;
      s = nouveau;
      tx = cx - px * s;
      ty = cy - py * s;
      geste = { dist, s, cx, cy };
    } else {
      tx += p.x - avant.x;
      ty += p.y - avant.y;
    }
    appliquer();
  });

  const fin = (e: PointerEvent) => {
    poignee = null;
    pointeurs.delete(e.pointerId);
    debutGeste();
  };
  scene.addEventListener('pointerup', fin);
  scene.addEventListener('pointercancel', fin);

  scene.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = posScene(e);
    const px = (p.x - tx) / s;
    const py = (p.y - ty) / s;
    s *= Math.exp(-e.deltaY * 0.0015);
    contraindre();
    tx = p.x - px * s;
    ty = p.y - py * s;
    appliquer();
  }, { passive: false });

  document.addEventListener('keydown', surTouche);
  window.addEventListener('resize', ajuster);
  img.addEventListener('load', ajuster, { once: true });
  img.src = photo.src;
  barre();
  if (options.recadrerDirect) {
    img.addEventListener('load', () => {
      rogne = { x0: photo.w * 0.05, y0: photo.h * 0.05, x1: photo.w * 0.95, y1: photo.h * 0.95 };
      barre();
      appliquer();
    }, { once: true });
  }
}
