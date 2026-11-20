import katex from 'katex';
import 'katex/dist/katex.min.css';

/** Formule LaTeX rendue (KaTeX) ; en cas d'échec, le source en clair. */
export function formule(latex: string): HTMLElement {
  const el = Object.assign(document.createElement('span'), { className: 'maths' });
  try {
    katex.render(latex, el, { throwOnError: true });
  } catch {
    el.textContent = latex;
    el.classList.add('erreur');
  }
  return el;
}

/** Texte français avec du LaTeX en ligne entre $…$. */
export function noteTexte(texte: string): HTMLElement {
  const el = document.createElement('span');
  texte.split(/(\$[^$]+\$)/).forEach((morceau, i) => {
    if (i % 2 === 1) el.append(formule(morceau.slice(1, -1)));
    else if (morceau) el.append(morceau);
  });
  return el;
}

/** Texte de plusieurs paragraphes (séparés par une ligne vide), formules $…$ rendues. */
export function paragraphes(texte: string): HTMLElement[] {
  return texte
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const el = document.createElement('p');
      el.className = 'para';
      el.append(noteTexte(p));
      return el;
    });
}
