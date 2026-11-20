import { get, set } from 'idb-keyval';
import { cle } from './pages';

/** Consommation de Claude pour une page : appels (correction, discussion), tokens et coût équivalent au tarif public (l'abonnement Pro ne facture pas à l'appel, mais décompte son quota). */
export interface Usage {
  appels: number;
  tokensEntree: number;
  tokensSortie: number;
  coutUsd: number;
}

const vide = (): Usage => ({ appels: 0, tokensEntree: 0, tokensSortie: 0, coutUsd: 0 });
let courant: Usage = vide();

export async function chargerUsage(): Promise<void> {
  courant = vide();
  try {
    const raw = (await get(cle('usage'))) as Partial<Usage> | undefined;
    if (raw && typeof raw.appels === 'number') courant = { ...vide(), ...raw };
  } catch (e) {
    console.warn("Lecture de la consommation impossible", e);
  }
}

export const usageCourant = (): Usage => courant;

/** Ce que le serveur renvoie par appel : les tentatives (une relance éventuelle) avec leurs tokens et leur coût. */
export interface TentativeServeur {
  tokens_entree?: number | null;
  tokens_sortie?: number | null;
  cout_usd?: number | null;
}

export function ajouterUsage(tentatives: TentativeServeur[] | undefined): Usage {
  if (!tentatives?.length) return courant;
  courant = {
    appels: courant.appels + 1,
    tokensEntree: courant.tokensEntree + tentatives.reduce((s, t) => s + (t.tokens_entree ?? 0), 0),
    tokensSortie: courant.tokensSortie + tentatives.reduce((s, t) => s + (t.tokens_sortie ?? 0), 0),
    coutUsd: courant.coutUsd + tentatives.reduce((s, t) => s + (t.cout_usd ?? 0), 0),
  };
  set(cle('usage'), courant).catch((e) => console.warn("Sauvegarde de la consommation impossible", e));
  return courant;
}

const milliers = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)} k` : n.toLocaleString('fr-FR'));

/** Texte du menu : « 3 appels · 41 k tokens ». */
export function resumeUsage(u: Usage): string {
  if (!u.appels) return 'Aucun appel à Claude sur cette page';
  return `${u.appels} appel${u.appels > 1 ? 's' : ''} · ${milliers(u.tokensEntree + u.tokensSortie)} tokens`;
}
