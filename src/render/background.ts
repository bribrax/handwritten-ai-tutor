import { LARGEUR_FEUILLE, type Fond } from '../model';
import type { Viewport } from '../viewport';

// Le fond est un simple div CSS : net à tout zoom, zéro mémoire canvas.
const COULEUR = '#c3d0e6';
const CARREAU = 19; // ≈ 5 mm sur une feuille de 800 unités de large
const LIGNE = 30; // ≈ 8 mm

const ligne = (dir: string) => `linear-gradient(${dir}, ${COULEUR} 0 1px, transparent 1px)`;

export function setFond(page: HTMLElement, fond: Fond) {
  page.dataset.fond = fond;
  page.style.backgroundImage =
    fond === 'carreaux' ? `${ligne('to bottom')}, ${ligne('to right')}` : fond === 'ligne' ? ligne('to bottom') : 'none';
}

export function updatePage(page: HTMLElement, vp: Viewport) {
  const s = vp.scale;
  page.style.width = `${LARGEUR_FEUILLE * s}px`;
  page.style.height = `${vp.sheetH * s}px`;
  page.style.transform = `translate(${vp.tx}px, ${vp.ty}px)`;
  if (page.dataset.fond === 'carreaux') page.style.backgroundSize = `${CARREAU * s}px ${CARREAU * s}px`;
  else if (page.dataset.fond === 'ligne') page.style.backgroundSize = `100% ${LIGNE * s}px`;
}
