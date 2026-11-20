import { get, set } from 'idb-keyval';
import { lireFeuille, type Feuille } from './model';
import { cle, marquerModifiee } from './pages';

const DELAI_MS = 600;

let timer = 0;
let source: (() => Feuille) | null = null;

/** Feuille sauvegardée lors d'une session précédente, ou null. */
export async function charger(): Promise<Feuille | null> {
  try {
    const raw = await get(cle('feuille'));
    return raw ? lireFeuille(raw) : null;
  } catch (e) {
    console.warn('Lecture de la sauvegarde impossible', e);
    return null;
  }
}

/** Sauvegarde peu après la dernière modification (regroupe les rafales de traits). */
export function sauverPlusTard(lire: () => Feuille) {
  source = lire;
  clearTimeout(timer);
  timer = window.setTimeout(sauverMaintenant, DELAI_MS);
}

export async function sauverMaintenant() {
  clearTimeout(timer);
  if (!source) return;
  const f = source();
  source = null;
  try {
    await set(cle('feuille'), f);
    marquerModifiee();
  } catch (e) {
    console.warn('Sauvegarde impossible', e);
  }
}

// Quand l'app passe en arrière-plan ou se ferme, on n'attend pas le délai.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) void sauverMaintenant();
});
window.addEventListener('pagehide', () => void sauverMaintenant());

/** iOS peut purger les données d'un site peu utilisé : on demande un stockage durable. */
export function demanderStockageDurable() {
  void navigator.storage?.persist?.();
}
