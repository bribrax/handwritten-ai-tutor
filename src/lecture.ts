import { lireEnFond, type FeuilleLegere } from './reco';

const CALME_MS = 2500; // le groupe n'a pas changé depuis ce délai
const REESSAI_MS = 700; // stylet encore posé : on attend un peu
const PAUSE_ECHEC_MS = 60_000; // serveur injoignable : on arrête d'insister un moment

/**
 * Lecture en arrière-plan : quand la feuille reste inchangée ~2,5 s (et que le stylet n'écrit pas), le serveur lit les groupes
 * pas encore lus. Le regroupement se fait uniquement côté serveur (même code que pour Corriger) ; l'app ne connaît pas les groupes,
 * seulement « quelque chose a changé ». Une seule lecture à la fois ; toute modification annule la lecture en cours.
 */
export function createLectureFond(opts: { feuille: () => FeuilleLegere; ecrit: () => boolean }) {
  let minuteur = 0;
  let ctrl: AbortController | null = null;
  let pauseJusqua = 0;
  let inutile = false; // le serveur n'a pas de lecture d'avance à faire (entrée « image »)

  function annuler() {
    clearTimeout(minuteur);
    ctrl?.abort();
    ctrl = null;
  }

  async function lancer() {
    if (opts.ecrit()) {
      minuteur = window.setTimeout(lancer, REESSAI_MS);
      return;
    }
    const f = opts.feuille();
    if (f.traits.length === 0) return;
    ctrl = new AbortController();
    const c = ctrl;
    try {
      const r = await lireEnFond(f, c.signal);
      if (r.inactif) inutile = true;
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) pauseJusqua = performance.now() + PAUSE_ECHEC_MS; // injoignable : silencieux
    } finally {
      if (ctrl === c) ctrl = null;
    }
  }

  return {
    /** À appeler à chaque modification de la feuille : annule la lecture en cours et relance le délai. */
    planifier() {
      annuler();
      if (inutile || performance.now() < pauseJusqua) return;
      minuteur = window.setTimeout(lancer, CALME_MS);
    },
    annuler,
  };
}
