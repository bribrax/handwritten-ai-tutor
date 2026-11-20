import type { Bloc } from '../blocs';
import { paragraphes } from '../ui/latex';
import type { Viewport } from '../viewport';
import '@fontsource/caveat/latin-500.css';
import '@fontsource/caveat/latin-700.css';

/** Taille du texte des blocs, en unités feuille. Tout le reste (marges, espace de réponse) est en « em » de cette taille. */
export const TAILLE_TEXTE = 26;

const ETOILES = (d?: number) => (d ? ` ${'★'.repeat(d)}${'☆'.repeat(3 - d)}` : '');

/** Contenu d'un bloc : texte manuscrit (formules KaTeX) puis, pour un exercice, l'espace de réponse. */
function contenu(b: Bloc): HTMLElement[] {
  const texte = Object.assign(document.createElement('div'), { className: 'texte' });
  if (b.type === 'exercice') {
    texte.append(Object.assign(document.createElement('div'), { className: 'etiquette', textContent: `Exercice ${b.numero ?? ''}${ETOILES(b.difficulte)}` }));
  }
  if (b.type === 'tuteur') texte.append(Object.assign(document.createElement('div'), { className: 'etiquette', textContent: '✎ Le tuteur' }));
  texte.append(...paragraphes(b.texte));
  const els = [texte];
  if (b.reserve > 0) {
    const r = Object.assign(document.createElement('div'), { className: 'reserve' });
    r.style.height = `${b.reserve / TAILLE_TEXTE}em`;
    r.append(Object.assign(document.createElement('span'), { textContent: 'à toi ✎' }));
    els.push(r);
  }
  return els;
}

/** Clé de ce qui change l'apparence du contenu (pas la position) : le contenu n'est refait que si elle change. */
const cleContenu = (b: Bloc) => `${b.type}|${b.numero ?? ''}|${b.difficulte ?? ''}|${b.reserve}|${b.texte}`;

let mesureur: HTMLElement | null = null;

/** Hauteur du texte du bloc (unités feuille) pour la largeur l, sans l'espace de réponse. Les polices doivent être chargées (voir polices()). */
export function mesurerTexte(b: Pick<Bloc, 'type' | 'texte' | 'l' | 'numero' | 'difficulte'>): number {
  if (!mesureur) {
    mesureur = Object.assign(document.createElement('div'), { className: 'bloc mesure' });
    document.body.appendChild(mesureur);
  }
  mesureur.className = `bloc mesure ${b.type}`;
  mesureur.style.width = `${b.l}px`;
  mesureur.style.fontSize = `${TAILLE_TEXTE}px`;
  mesureur.replaceChildren(contenu({ ...b, id: '', x: 0, y: 0, hTexte: 0, reserve: 0 }).at(0)!);
  return Math.ceil(mesureur.getBoundingClientRect().height * 1.03) + 8; // petite marge : le rendu à l'écran ne coïncide pas au pixel près
}

/** Attend les polices manuscrite et KaTeX avant de mesurer. */
export async function polices(): Promise<void> {
  try {
    await Promise.all([document.fonts.load(`500 ${TAILLE_TEXTE}px Caveat`), document.fonts.load(`700 ${TAILLE_TEXTE}px Caveat`)]);
    // Les polices KaTeX ne se chargent qu'à la première formule rendue : une sonde avec les styles courants les déclenche (italique, droit, grands opérateurs, ℝ…).
    const sonde = Object.assign(document.createElement('div'), { className: 'bloc mesure' });
    sonde.append(...paragraphes('$x_k^2 \\int_{-\\infty}^{+\\infty} \\sum \\frac{a}{b} \\mathbb{R} \\hat{x} \\left[ \\dfrac{1}{2} \\right] \\mathcal{F} \\mathrm{e}$'));
    document.body.appendChild(sonde);
    void sonde.offsetHeight; // force la mise en page : les polices sont alors demandées
    await document.fonts.ready;
    sonde.remove();
  } catch {
    /* mesure approximative si les polices ne se chargent pas */
  }
}

/** Calque des blocs de texte posés sur la feuille (cours, énoncés) : entre le fond et l'encre, sans événement propre. */
export function createBlocsFeuille(parent: HTMLElement, avant: Node) {
  const couche = Object.assign(document.createElement('div'), { id: 'blocs-feuille' });
  parent.insertBefore(couche, avant);
  const els = new Map<string, HTMLElement>();

  return {
    rendre(blocs: readonly Bloc[], vp: Viewport) {
      for (const [id, el] of els) {
        if (!blocs.some((b) => b.id === id)) {
          el.remove();
          els.delete(id);
        }
      }
      const s = vp.scale;
      for (const b of blocs) {
        let el = els.get(b.id);
        if (!el) {
          el = Object.assign(document.createElement('div'), { className: `bloc ${b.type}` });
          couche.appendChild(el);
          els.set(b.id, el);
        }
        const cle = cleContenu(b);
        if (el.dataset.cle !== cle) {
          el.dataset.cle = cle;
          el.className = `bloc ${b.type}`;
          el.replaceChildren(...contenu(b));
        }
        el.style.fontSize = `${TAILLE_TEXTE * s}px`;
        el.style.width = `${b.l * s}px`;
        el.style.transform = `translate(${vp.tx + b.x * s}px, ${vp.ty + b.y * s}px)`;
      }
    },
    /** Le bloc dont le TEXTE contient ce point de la feuille (l'espace de réponse ne se sélectionne pas : on y écrit). */
    trouver(blocs: readonly Bloc[], x: number, y: number): Bloc | null {
      for (let i = blocs.length - 1; i >= 0; i--) {
        const b = blocs[i];
        if (x >= b.x && x <= b.x + b.l && y >= b.y && y <= b.y + b.hTexte) return b;
      }
      return null;
    },
  };
}
