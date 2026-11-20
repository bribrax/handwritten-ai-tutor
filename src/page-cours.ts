import { RESERVE, type BrouillonBloc } from './blocs';
import type { Cours, Exercice, SectionCours } from './cours';

/** Blocs d'une page de cours : titre, sections (titre + texte), puis chaque exercice suivi de son espace de réponse. */
export function blocsDuCours(c: Cours): BrouillonBloc[] {
  const blocs: BrouillonBloc[] = [{ type: 'titre', texte: c.titre, coursId: c.id }, ...blocsSections(c.id, c.sections)];
  if (c.exercices.length) {
    blocs.push({ type: 'section', texte: 'Exercices', coursId: c.id });
    c.exercices.forEach((e, i) => blocs.push(blocExercice(c.id, e, i + 1)));
  }
  return blocs;
}

export function blocsSections(coursId: string, sections: SectionCours[]): BrouillonBloc[] {
  return sections.flatMap((s) => [
    { type: 'section' as const, texte: s.titre, coursId },
    { type: 'texte' as const, texte: s.texte, coursId },
  ]);
}

export function blocExercice(coursId: string, e: Exercice, numero: number): BrouillonBloc {
  return { type: 'exercice', texte: e.enonce, coursId, exerciceId: e.id, numero, difficulte: e.difficulte, reserve: RESERVE[e.difficulte] };
}

/** Exercices ajoutés ensuite (demande écrite) : posés en bas de la page, numérotés à la suite des existants. */
export function blocsNouveauxExercices(c: Cours, nouveaux: Exercice[]): BrouillonBloc[] {
  return nouveaux.map((e) => blocExercice(c.id, e, c.exercices.findIndex((x) => x.id === e.id) + 1));
}
