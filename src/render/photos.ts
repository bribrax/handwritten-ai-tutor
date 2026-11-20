import type { Photo } from '../photos';
import type { Viewport } from '../viewport';

/** Hauteur d'une photo posée sur la feuille, en unités feuille. */
export const hauteurPhoto = (p: Photo): number => (p.pos ? (p.pos.l * p.h) / p.w : 0);

/**
 * Calque des photos posées sur la feuille : des <img> entre le fond de page et l'encre (l'écriture reste visible dessus).
 * Les photos ne reçoivent aucun événement : on les sélectionne par un appui du doigt (voir main.ts).
 */
export function createPhotosFeuille(parent: HTMLElement, avant: Node) {
  const couche = Object.assign(document.createElement('div'), { id: 'photos-feuille' });
  parent.insertBefore(couche, avant);
  const els = new Map<string, HTMLImageElement>();

  return {
    rendre(photos: readonly Photo[], vp: Viewport) {
      const posees = photos.filter((p) => p.pos);
      for (const [id, el] of els) {
        if (!posees.some((p) => p.id === id)) {
          el.remove();
          els.delete(id);
        }
      }
      for (const p of posees) {
        let el = els.get(p.id);
        if (!el) {
          el = Object.assign(document.createElement('img'), { alt: '', draggable: false });
          couche.appendChild(el);
          els.set(p.id, el);
        }
        if (el.dataset.src !== p.src) {
          el.src = p.src;
          el.dataset.src = p.src;
        }
        const { x, y, l } = p.pos!;
        const s = vp.scale;
        el.style.width = `${l * s}px`;
        el.style.height = `${hauteurPhoto(p) * s}px`;
        el.style.transform = `translate(${vp.tx + x * s}px, ${vp.ty + y * s}px)`;
      }
    },
    /** La photo posée (la plus haute dans l'empilement) qui contient ce point de la feuille. */
    trouver(photos: readonly Photo[], x: number, y: number): Photo | null {
      for (let i = photos.length - 1; i >= 0; i--) {
        const p = photos[i];
        if (p.pos && x >= p.pos.x && x <= p.pos.x + p.pos.l && y >= p.pos.y && y <= p.pos.y + hauteurPhoto(p)) return p;
      }
      return null;
    },
  };
}
