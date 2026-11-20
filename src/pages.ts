import { del, get, set } from 'idb-keyval';

/** Une page du cahier. Chaque page a sa feuille, ses annotations, ses précisions, sa discussion et ses photos d'énoncé. */
export interface InfoPage {
  id: string;
  nom: string;
  cree: number;
  modifie: number;
  /** Page créée pour ce cours (voir cours.ts). */
  coursId?: string;
}

interface Index {
  courante: string;
  pages: InfoPage[];
}

const CLE_INDEX = 'pages';
/** La première page garde les clés d'origine (« feuille », « annotations »…) : rien à migrer pour qui avait déjà une feuille. */
const ID_PREMIERE = 'p1';
/** Données stockées par page (clé de base ; voir cle()). */
const BASES = ['feuille', 'annotations', 'precisions', 'conversation', 'photos', 'usage', 'blocs'] as const;

let index: Index = { courante: ID_PREMIERE, pages: [{ id: ID_PREMIERE, nom: 'Page 1', cree: Date.now(), modifie: Date.now() }] };

/** Clé IndexedDB d'une donnée de la page courante. */
export function cle(base: (typeof BASES)[number], id = index.courante): string {
  return id === ID_PREMIERE ? base : `${base}:${id}`;
}

function valide(raw: unknown): raw is Index {
  const o = raw as Partial<Index> | null;
  return !!o && typeof o.courante === 'string' && Array.isArray(o.pages) && o.pages.length > 0 && o.pages.some((p) => p?.id === o.courante);
}

function sauverIndex(): void {
  set(CLE_INDEX, index).catch((e) => console.warn('Sauvegarde des pages impossible', e));
}

export async function chargerPages(): Promise<void> {
  try {
    const raw = await get(CLE_INDEX);
    if (valide(raw)) index = raw;
  } catch (e) {
    console.warn('Lecture des pages impossible', e);
  }
}

export const pageCourante = (): InfoPage => index.pages.find((p) => p.id === index.courante)!;
export const pageExiste = (id: string): boolean => index.pages.some((p) => p.id === id);
export const listePages = (): readonly InfoPage[] => index.pages;

export function choisirPage(id: string): void {
  if (!index.pages.some((p) => p.id === id)) return;
  index = { ...index, courante: id };
  sauverIndex();
}

/** Crée une page vide et la rend courante. */
export function creerPage(nom?: string, coursId?: string): InfoPage {
  let n = index.pages.length + 1;
  while (index.pages.some((p) => p.nom === `Page ${n}`)) n++;
  const p: InfoPage = { id: crypto.randomUUID().slice(0, 8), nom: nom?.trim().slice(0, 60) || `Page ${n}`, cree: Date.now(), modifie: Date.now(), ...(coursId ? { coursId } : {}) };
  index = { courante: p.id, pages: [...index.pages, p] };
  sauverIndex();
  return p;
}

export function renommerPage(id: string, nom: string): void {
  const p = index.pages.find((x) => x.id === id);
  if (!p || !nom.trim()) return;
  p.nom = nom.trim().slice(0, 60);
  sauverIndex();
}

/** Note que la page courante a été modifiée (tri de la liste) ; n'écrit pas à chaque trait. */
let dernierMarquage = 0;
export function marquerModifiee(): void {
  const maintenant = Date.now();
  pageCourante().modifie = maintenant;
  if (maintenant - dernierMarquage > 10_000) {
    dernierMarquage = maintenant;
    sauverIndex();
  }
}

/**
 * Supprime une page et ses données. Renvoie l'id de la page à ouvrir ensuite si c'était la courante
 * (la plus récente des autres), ou null. La dernière page ne peut pas être supprimée.
 */
export async function supprimerPage(id: string): Promise<string | null> {
  if (index.pages.length <= 1) return null;
  const restantes = index.pages.filter((p) => p.id !== id);
  const etaitCourante = index.courante === id;
  const suivante = etaitCourante ? [...restantes].sort((a, b) => b.modifie - a.modifie)[0].id : index.courante;
  index = { courante: suivante, pages: restantes };
  sauverIndex();
  await Promise.all(BASES.map((b) => del(cle(b, id)).catch(() => undefined)));
  return etaitCourante ? suivante : null;
}
