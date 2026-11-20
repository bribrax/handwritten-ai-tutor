import { get, set } from 'idb-keyval';
import { cle } from './pages';
import { TAILLE_TEXTE, mesurerTexte, polices } from './render/blocs';

export type TypeBloc = 'titre' | 'section' | 'texte' | 'exercice' | 'tuteur';

/**
 * Bloc de texte posé sur la feuille (page de cours) : écrit « à la main » (police manuscrite, formules KaTeX), déplaçable.
 * Un exercice est suivi d'un espace de réponse (`reserve`) où l'élève écrit au stylet.
 */
export interface Bloc {
  id: string;
  type: TypeBloc;
  texte: string;
  /** Coin haut-gauche et largeur, en unités feuille. */
  x: number;
  y: number;
  l: number;
  /** Hauteur du texte (mesurée), sans l'espace de réponse. */
  hTexte: number;
  /** Hauteur de l'espace de réponse sous le texte (exercices), en unités feuille. */
  reserve: number;
  coursId?: string;
  exerciceId?: string;
  numero?: number;
  difficulte?: number;
}

export const X_BLOC = 60;
export const LARGEUR_BLOC = 640;
export const LARGEUR_BLOC_MIN = 220;
/** Espace de réponse sous un exercice selon sa difficulté. */
export const RESERVE = { 1: 260, 2: 340, 3: 440 } as const;
/** Espace ajouté par « + de place ». */
export const PLACE_SUPPLEMENTAIRE = 200;
const ECART = { titre: 16, section: 6, texte: 18, exercice: 36, tuteur: 14 } as const;

let liste: Bloc[] = [];

const valide = (b: unknown): b is Bloc => {
  const o = b as Partial<Bloc> | null;
  return (
    !!o && typeof o.id === 'string' && typeof o.texte === 'string' && ['titre', 'section', 'texte', 'exercice', 'tuteur'].includes(o.type as string) &&
    [o.x, o.y, o.l, o.hTexte, o.reserve].every((v) => typeof v === 'number' && Number.isFinite(v)) && (o.l as number) > 0
  );
};

export async function chargerBlocs(): Promise<void> {
  liste = [];
  try {
    const raw = await get(cle('blocs'));
    if (Array.isArray(raw)) liste = raw.filter(valide);
  } catch (e) {
    console.warn('Lecture des blocs impossible', e);
  }
  if (liste.length) await polices();
}

export function sauverBlocs(): void {
  set(cle('blocs'), liste).catch((e) => console.warn('Sauvegarde des blocs impossible', e));
}

export const listeBlocs = (): readonly Bloc[] => liste;
export const trouverBloc = (id: string): Bloc | undefined => liste.find((b) => b.id === id);

/** Remplace tous les blocs (import d'une page). */
export function remplacerBlocs(blocs: unknown[]): void {
  liste = blocs.filter(valide);
  sauverBlocs();
}

/** Modifie un bloc ; si la largeur ou le texte change, la hauteur du texte est remesurée. `sauvegarder: false` pendant un geste. */
export function majBloc(id: string, patch: Partial<Pick<Bloc, 'x' | 'y' | 'l' | 'reserve' | 'texte'>>, sauvegarder = true): Bloc | undefined {
  const b = trouverBloc(id);
  if (!b) return undefined;
  Object.assign(b, patch);
  if (patch.l !== undefined || patch.texte !== undefined) b.hTexte = mesurerTexte(b);
  if (sauvegarder) sauverBlocs();
  return b;
}

export function retirerBloc(id: string): void {
  liste = liste.filter((b) => b.id !== id);
  sauverBlocs();
}

/** Bas d'un bloc (texte + espace de réponse). */
export const basBloc = (b: Bloc): number => b.y + b.hTexte + b.reserve;

/** Décale vers le bas les blocs dont le haut est sous `seuil` (« + de place »). */
export function decalerBlocs(seuil: number, dy: number, sauf?: string): void {
  for (const b of liste) if (b.y >= seuil && b.id !== sauf) b.y += dy;
  sauverBlocs();
}

/** Ce que Claude doit savoir des exercices posés sur la feuille : énoncé et zone de réponse. */
export function blocsPourServeur(): { numero?: number; enonce: string; zone: [number, number, number, number] }[] {
  return liste
    .filter((b) => b.type === 'exercice' && b.reserve > 0)
    .map((b) => ({ numero: b.numero, enonce: b.texte, zone: [b.x, b.y + b.hTexte, b.x + b.l, b.y + b.hTexte + b.reserve] }));
}

/** Pose un bloc à la hauteur `y` (explication écrite par le tuteur sous une ligne) : la place a déjà été faite par l'appelant. */
export async function poserBloc(d: BrouillonBloc, y: number): Promise<Bloc> {
  await polices();
  const b: Bloc = { ...d, id: crypto.randomUUID(), x: X_BLOC, y, l: d.l ?? LARGEUR_BLOC, hTexte: 0, reserve: d.reserve ?? 0 };
  b.hTexte = mesurerTexte(b);
  liste = [...liste, b];
  sauverBlocs();
  return b;
}

export type BrouillonBloc = Omit<Bloc, 'id' | 'x' | 'y' | 'l' | 'hTexte' | 'reserve'> & { reserve?: number; l?: number };

/**
 * Ajoute des blocs en dessous de tout ce qui est déjà sur la page (`yDepart`), mesurés puis empilés avec leurs espaces de réponse.
 * Renvoie les blocs créés.
 */
export async function ajouterEnBas(brouillons: BrouillonBloc[], yDepart: number): Promise<Bloc[]> {
  await polices();
  let y = yDepart;
  const crees: Bloc[] = [];
  for (const d of brouillons) {
    const l = d.l ?? LARGEUR_BLOC;
    const b: Bloc = { ...d, id: crypto.randomUUID(), x: X_BLOC, y, l, hTexte: 0, reserve: d.reserve ?? 0 };
    b.hTexte = mesurerTexte(b);
    crees.push(b);
    y += b.hTexte + b.reserve + ECART[b.type];
  }
  liste = [...liste, ...crees];
  sauverBlocs();
  return crees;
}

export { TAILLE_TEXTE };
