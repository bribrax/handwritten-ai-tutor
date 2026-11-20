import { LARGEUR_FEUILLE } from '../model';
import { LARGEUR_PHOTO_MIN, type Photo, type PosPhoto } from '../photos';
import { hauteurPhoto } from '../render/photos';
import type { Viewport } from '../viewport';

export interface CadreHooks {
  /** Position/taille modifiée pendant le geste (aperçu immédiat, pas encore sauvegardée). */
  onChange(id: string, pos: PosPhoto): void;
  /** Geste terminé : sauvegarder. */
  onFin(id: string): void;
  onRecadrer(id: string): void;
  onRetirer(id: string): void;
  onFermer(): void;
}

type Poignee = 'corps' | 'nw' | 'ne' | 'sw' | 'se';

/**
 * Cadre d'édition de la photo sélectionnée sur la feuille : glisser le corps = déplacer, glisser un coin = redimensionner (proportions gardées).
 * Le stylet et le doigt agissent tous deux sur le cadre ; les événements ne remontent pas à la feuille (pas de tracé, pas de défilement).
 */
export function createPhotoCadre(parent: HTMLElement, vp: Viewport, hooks: CadreHooks) {
  const el = Object.assign(document.createElement('div'), { id: 'photo-cadre' });
  const barre = Object.assign(document.createElement('div'), { className: 'actions' });
  const bouton = (texte: string, fn: () => void, cls = '') => {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: texte, className: cls });
    b.addEventListener('click', fn);
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    return b;
  };
  barre.append(
    bouton('Recadrer', () => photo && hooks.onRecadrer(photo.id)),
    bouton('Retirer', () => photo && hooks.onRetirer(photo.id), 'danger'),
    bouton('OK', () => hooks.onFermer(), 'principal'),
  );
  el.append(barre);
  for (const h of ['nw', 'ne', 'sw', 'se'] as const) {
    const coin = Object.assign(document.createElement('span'), { className: `coin ${h}` });
    coin.dataset.h = h; // dataset est en lecture seule : on ne peut pas le passer à Object.assign
    el.append(coin);
  }
  el.hidden = true;
  parent.appendChild(el);

  // La feuille annule touchstart/click (anti double-tap Safari), ce qui tuerait aussi les clics sur nos boutons : ils ne doivent pas y remonter.
  for (const ev of ['touchstart', 'touchmove', 'click', 'dblclick']) el.addEventListener(ev, (e) => e.stopPropagation());

  let photo: Photo | null = null;
  let geste: { h: Poignee; pointeur: number; x: number; y: number; depart: PosPhoto; hauteur: number } | null = null;

  function placer() {
    if (!photo?.pos) {
      el.hidden = true;
      return;
    }
    const { x, y, l } = photo.pos;
    const s = vp.scale;
    el.hidden = false;
    el.style.width = `${l * s}px`;
    el.style.height = `${hauteurPhoto(photo) * s}px`;
    el.style.transform = `translate(${vp.tx + x * s}px, ${vp.ty + y * s}px)`;
    // Les actions passent sous la photo si elle touche le haut de l'écran.
    el.classList.toggle('actions-bas', vp.ty + y * s < 64);
  }

  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!photo?.pos || geste) return;
    const cible = (e.target as HTMLElement).dataset.h as Poignee | undefined;
    geste = { h: cible ?? 'corps', pointeur: e.pointerId, x: e.clientX, y: e.clientY, depart: { ...photo.pos }, hauteur: hauteurPhoto(photo) };
    el.setPointerCapture(e.pointerId);
  });

  el.addEventListener('pointermove', (e) => {
    e.stopPropagation();
    if (!geste || !photo || e.pointerId !== geste.pointeur) return;
    e.preventDefault();
    const dx = (e.clientX - geste.x) / vp.scale;
    const dy = (e.clientY - geste.y) / vp.scale;
    const d = geste.depart;
    let { x, y, l } = d;
    if (geste.h === 'corps') {
      x = Math.min(LARGEUR_FEUILLE - l, Math.max(0, d.x + dx));
      y = Math.max(0, d.y + dy);
    } else {
      // Proportions gardées : la largeur suit la moyenne des projections horizontale et verticale du geste.
      const ratio = photo.w / photo.h;
      const sx = geste.h.includes('w') ? -1 : 1;
      const sy = geste.h.includes('n') ? -1 : 1;
      l = d.l + (sx * dx + sy * dy * ratio) / 2;
      l = Math.min(LARGEUR_FEUILLE, Math.max(LARGEUR_PHOTO_MIN, l));
      if (sx < 0) x = d.x + d.l - l; // le coin opposé reste fixe
      if (sy < 0) y = d.y + geste.hauteur - (l * photo.h) / photo.w;
      x = Math.min(LARGEUR_FEUILLE - l, Math.max(0, x));
      y = Math.max(0, y);
    }
    hooks.onChange(photo.id, { x, y, l });
  });

  const fin = (e: PointerEvent) => {
    e.stopPropagation();
    if (!geste || e.pointerId !== geste.pointeur) return;
    geste = null;
    if (photo) hooks.onFin(photo.id);
  };
  el.addEventListener('pointerup', fin);
  el.addEventListener('pointercancel', fin);

  return {
    get idSelectionne() {
      return photo?.id ?? null;
    },
    /** Sélectionne la photo (null = désélection) ou met à jour le cadre après un changement. */
    afficher(p: Photo | null) {
      photo = p;
      placer();
    },
    suivre: placer,
  };
}
