import { get, set } from 'idb-keyval';

/** Avancée d'un exercice. « avec_aide » : la solution a été consultée. Les autres statuts viendront avec le suivi (correction de la page de l'exercice). */
export type StatutExercice = 'a_faire' | 'en_cours' | 'reussi' | 'avec_aide' | 'erreurs';

export interface Exercice {
  id: string;
  enonce: string;
  /** 1 = application directe, 2 = moyen, 3 = difficile. */
  difficulte: 1 | 2 | 3;
  indice: string;
  solution: string;
  statut: StatutExercice;
}

export interface SectionCours {
  titre: string;
  texte: string;
}

export interface MessageCours {
  role: 'eleve' | 'tuteur';
  texte: string;
}

/** Un cours généré par Claude sur une notion. Global à l'appareil (pas lié à une page du cahier). */
export interface Cours {
  id: string;
  titre: string;
  notion: string;
  niveau: string;
  cree: number;
  modifie: number;
  sections: SectionCours[];
  exercices: Exercice[];
  messages: MessageCours[];
  /** Page du cahier où le cours est écrit (absente pour un cours créé avant les pages de cours). */
  pageId?: string;
}

const CLE = 'cours';
const MESSAGES_MAX = 60;
let liste: Cours[] = [];

const valide = (c: unknown): c is Cours => {
  const o = c as Partial<Cours> | null;
  return !!o && typeof o.id === 'string' && typeof o.titre === 'string' && Array.isArray(o.sections) && Array.isArray(o.exercices) && Array.isArray(o.messages);
};

export async function chargerCours(): Promise<void> {
  try {
    const raw = await get(CLE);
    if (Array.isArray(raw)) liste = raw.filter(valide);
  } catch (e) {
    console.warn('Lecture des cours impossible', e);
  }
}

function sauver(): void {
  set(CLE, liste).catch((e) => console.warn('Sauvegarde des cours impossible', e));
}

/** Du plus récemment modifié au plus ancien. */
export const listeCours = (): Cours[] => [...liste].sort((a, b) => b.modifie - a.modifie);
export const trouverCours = (id: string): Cours | undefined => liste.find((c) => c.id === id);

/** Données d'un cours telles que renvoyées par le serveur. */
export interface DonneesCours {
  titre: string;
  sections: SectionCours[];
  exercices: { enonce: string; difficulte: number; indice: string; solution: string }[];
}

const versExercice = (e: DonneesCours['exercices'][number]): Exercice => ({
  id: crypto.randomUUID(),
  enonce: e.enonce,
  difficulte: e.difficulte === 1 || e.difficulte === 3 ? e.difficulte : 2,
  indice: e.indice,
  solution: e.solution,
  statut: 'a_faire',
});

export function creerCours(notion: string, niveau: string, d: DonneesCours): Cours {
  const maintenant = Date.now();
  const c: Cours = {
    id: crypto.randomUUID(),
    titre: d.titre || notion.slice(0, 80) || 'Cours',
    notion,
    niveau,
    cree: maintenant,
    modifie: maintenant,
    sections: d.sections,
    exercices: d.exercices.map(versExercice),
    messages: [],
  };
  liste = [...liste, c];
  sauver();
  return c;
}

/** Applique une réponse à une demande : sections remplacées si le serveur en renvoie, exercices ajoutés ; renvoie les exercices ajoutés. */
export function appliquerReponse(id: string, d: Partial<DonneesCours>): Exercice[] {
  const c = trouverCours(id);
  if (!c) return [];
  if (d.titre) c.titre = d.titre;
  if (d.sections?.length) c.sections = d.sections;
  const nouveaux = (d.exercices ?? []).map(versExercice);
  c.exercices = [...c.exercices, ...nouveaux];
  c.modifie = Date.now();
  sauver();
  return nouveaux;
}

export function ajouterMessage(id: string, role: MessageCours['role'], texte: string): void {
  const c = trouverCours(id);
  if (!c) return;
  c.messages = [...c.messages, { role, texte }].slice(-MESSAGES_MAX);
  c.modifie = Date.now();
  sauver();
}

export function definirStatut(id: string, exerciceId: string, statut: StatutExercice): void {
  const e = trouverCours(id)?.exercices.find((x) => x.id === exerciceId);
  if (!e) return;
  e.statut = statut;
  sauver();
}

export function definirPageCours(id: string, pageId: string): void {
  const c = trouverCours(id);
  if (!c) return;
  c.pageId = pageId;
  sauver();
}

export function supprimerCours(id: string): void {
  liste = liste.filter((c) => c.id !== id);
  sauver();
}

/** Progression résumée : exercices faits (réussis ou avec aide) sur le total. */
export function progression(c: Cours): { faits: number; total: number } {
  return { faits: c.exercices.filter((e) => e.statut === 'reussi' || e.statut === 'avec_aide').length, total: c.exercices.length };
}
