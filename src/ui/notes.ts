import '@fontsource/caveat/latin-500.css';
import { etat, type ItemAnnotation } from '../annotations';
import type { Trait } from '../model';
import { bboxOf } from '../render/ink';
import type { Rect } from '../render/layers';
import { COULEUR_ANNOTATION } from '../render/annotations';
import type { Viewport } from '../viewport';
import { formule, noteTexte } from './latex';

const BORD_DROIT = 792; // les notes ne sortent pas de la feuille (largeur 800)
const LARGEUR_MIN = 130; // en dessous, la note passe sous la ligne
const ECART = 3;

interface Placee {
  a: ItemAnnotation;
  el: HTMLElement;
}

/** Contenu de la note d'une annotation, ou null s'il n'y a rien à écrire en marge (ex. « ok »). */
function contenu(a: ItemAnnotation): HTMLElement | null {
  const c = document.createElement('div');
  if (a.type === 'lecture_douteuse' && a.lu && a.propose) {
    c.append("j'ai lu ", formule(a.lu), ', c’est ', formule(a.propose), ' ?');
    if (a.note) c.append(document.createElement('br'), noteTexte(a.note));
    return c;
  }
  if (!a.note) return null;
  c.append(noteTexte(a.note));
  return c;
}

/**
 * Notes manuscrites dans la marge droite, alignées sur leur ligne. Ce sont des éléments HTML (KaTeX, police Caveat)
 * placés en coordonnées feuille dans un conteneur dont la transformation suit le viewport.
 */
export function createNotes(root: HTMLElement, traits: () => Trait[]) {
  const conteneur = Object.assign(document.createElement('div'), { id: 'notes' });
  root.appendChild(conteneur);
  let notes: Placee[] = [];

  /**
   * Place chaque note à droite de sa ligne, sinon dessous, en évitant l'encre de l'élève et les autres notes :
   * si l'emplacement est pris, la note descend jusqu'à trouver de la place.
   */
  function disposer() {
    const encre = traits().map(bboxOf);
    const rects: Rect[] = [];
    const libre = (x: number, y: number, w: number, h: number) =>
      ![...rects, ...encre].some((r) => x < r.x1 + ECART && x + w > r.x0 - ECART && y < r.y1 + ECART && y + h > r.y0 - ECART);
    for (const { a, el } of [...notes].sort((p, q) => p.a.bbox[1] - q.a.bbox[1])) {
      const [bx0, by0, bx1, by1] = a.bbox;
      // Le cercle rouge déborde de la boîte de la ligne : on laisse la place.
      const droite = bx1 + (bx1 - bx0) * 0.06 + 18;
      const essais = [
        ...(BORD_DROIT - droite >= LARGEUR_MIN ? [{ x: droite, y: by0 - 2 }] : []),
        { x: bx0, y: by1 + 14 },
      ];
      let meilleur: { x: number; y: number; w: number; h: number; cout: number } | null = null;
      for (const e of essais) {
        const w = BORD_DROIT - e.x;
        el.style.width = `${w}px`;
        const h = el.offsetHeight;
        let y = e.y;
        for (let k = 0; k < 80 && !libre(e.x, y, w, h); k++) y += 6;
        const cout = y - e.y;
        if (!meilleur || cout < meilleur.cout) meilleur = { x: e.x, y, w, h, cout };
        if (cout <= 12) break; // emplacement quasi idéal : inutile d'essayer l'autre
      }
      const m = meilleur!;
      el.style.left = `${m.x}px`;
      el.style.top = `${m.y}px`;
      el.style.width = `${m.w}px`;
      rects.push({ x0: m.x, y0: m.y, x1: m.x + m.w, y1: m.y + m.h });
    }
  }

  function majEstompage() {
    for (const { a, el } of notes) el.classList.toggle('estompee', a.estompee);
  }

  /** Reconstruit toutes les notes (nouvelle correction, rechargement, affichage/masquage). */
  function reconstruire() {
    conteneur.replaceChildren();
    notes = [];
    conteneur.style.display = etat.visibles ? '' : 'none';
    if (!etat.visibles) return;
    for (const a of etat.items) {
      const c = contenu(a);
      if (!c) continue;
      const el = Object.assign(document.createElement('div'), { className: `note ${a.type}` });
      el.style.color = COULEUR_ANNOTATION[a.type];
      el.append(c);
      conteneur.appendChild(el);
      notes.push({ a, el });
    }
    disposer();
    majEstompage();
    // La hauteur des notes dépend de la police : on replace une fois Caveat chargée.
    void document.fonts?.ready.then(disposer);
  }

  return {
    reconstruire,
    majEstompage,
    /** Suit le viewport (une seule transformation CSS pour toutes les notes). */
    suivre(vp: Viewport) {
      conteneur.style.transform = `translate(${vp.tx}px, ${vp.ty}px) scale(${vp.scale})`;
    },
    /** Annotation sous le doigt : sa note, son cercle/coche (boîte de la ligne) ou son soulignement. */
    trouver(clientX: number, clientY: number, vp: Viewport): ItemAnnotation | null {
      if (!etat.visibles) return null;
      for (const { a, el } of notes) {
        const r = el.getBoundingClientRect();
        if (clientX >= r.left - 6 && clientX <= r.right + 6 && clientY >= r.top - 6 && clientY <= r.bottom + 6) return a;
      }
      const [x, y] = vp.toSheet(clientX, clientY);
      const marge = 14 / vp.scale;
      for (const a of etat.items) {
        const [x0, y0, x1, y1] = a.bbox;
        // Zone du cercle, de la coche (à droite de la ligne) et du soulignement (dessous) : bien plus petite qu'une page.
        if (x >= x0 - marge && x <= x1 + marge + 30 && y >= y0 - marge && y <= y1 + marge + 8) return a;
      }
      return null;
    },
  };
}
