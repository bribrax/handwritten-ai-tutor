import { get, set } from 'idb-keyval';
import { cle } from './pages';

/** Ce que l'élève a précisé à propos d'une ligne (« après le égal c'est un x »), retenu tant que la ligne n'est pas réécrite. */
export interface Precision {
  empreinte: string;
  texte: string;
  date: number;
}

const MAX = 200;
let liste: Precision[] = [];

export async function chargerPrecisions(): Promise<void> {
  liste = [];
  try {
    const raw = await get(cle('precisions'));
    if (Array.isArray(raw)) liste = raw.filter((p) => p && typeof p.empreinte === 'string' && typeof p.texte === 'string');
  } catch (e) {
    console.warn('Lecture des précisions impossible', e);
  }
}

function sauver(): void {
  set(cle('precisions'), liste).catch((e) => console.warn('Sauvegarde des précisions impossible', e));
}

/** Retient la précision d'une ligne (remplace la précédente pour la même ligne). */
export function ajouterPrecision(empreinte: string, texte: string): void {
  liste = [...liste.filter((p) => p.empreinte !== empreinte), { empreinte, texte, date: Date.now() }].slice(-MAX);
  sauver();
}

/** Ce qui part au serveur à chaque correction. */
export function precisionsPourServeur(): { empreinte: string; texte: string }[] {
  return liste.map(({ empreinte, texte }) => ({ empreinte, texte }));
}

/** Oublie les précisions des lignes qui n'existent plus telles quelles (réécrites ou effacées depuis). */
export function elaguerPrecisions(empreintesPresentes: Set<string>): void {
  const avant = liste.length;
  liste = liste.filter((p) => empreintesPresentes.has(p.empreinte));
  if (liste.length !== avant) sauver();
}
