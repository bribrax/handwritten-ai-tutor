import type { versFeuilleLegere } from './model';
import type { TentativeServeur } from './usage';

/** Feuille au format léger (voir model.ts). */
export type FeuilleLegere = ReturnType<typeof versFeuilleLegere>;

/** Un groupe de traits lu par le serveur (coordonnées de la feuille). */
export interface GroupeLu {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  latex: string;
  /** "lecture_echouee" : l'OCR n'a pas pu lire ce groupe (boucle ou plafond de tokens) ; latex vide. */
  statut?: string;
  /** Identifie la ligne tant qu'elle n'est pas réécrite (précisions de l'élève, reprise d'une annotation). */
  empreinte?: string;
}

/** Annotation de correction renvoyée par le serveur (champs selon le type ; groupe absent pour remarque_generale). */
export interface Annotation {
  type: 'ok' | 'erreur' | 'indice' | 'lecture_douteuse' | 'remarque_generale';
  groupe?: string;
  extrait?: string;
  note?: string;
  lu?: string;
  propose?: string;
  /** erreur : true = relue sur l'image du groupe (2e passe), false = relecture impossible. */
  verifiee?: boolean;
}

export interface Resultat {
  /** "image" : Claude a lu la feuille sur des images (pas de LaTeX lu) ; "ocr" / "ocr_image" : lecture TexTeller disponible. */
  entree?: string;
  groupes: GroupeLu[];
  /** Explications que le tuteur écrit sur la feuille, chacune sous la ligne `groupe` (voir main.ts). */
  explications?: { groupe: string; texte: string }[];
  /** Empreintes de toutes les lignes de la feuille (y compris figures et règles, absentes de `groupes`). */
  empreintes?: string[];
  annotations: Annotation[];
  /** Rien n'a changé depuis la dernière correction : Claude n'a pas été appelé. */
  rienDeNouveau?: boolean;
  /** Message clair si la correction a échoué (la lecture, elle, est disponible). */
  erreurCorrection?: string;
  /** Durée de l'appel à Claude, en secondes. */
  dureeCorrection?: number;
  /** Tokens et coût de l'appel (voir usage.ts). */
  tentatives?: TentativeServeur[];
}

const PORT_SERVEUR = 8765;
const DELAI_MS = 300_000; // CPU : ~2 s par ligne, puis l'appel à Claude

/** Serveur de lecture : celui du PC qui sert l'app (port 8765), ou `?reco=https://hôte:port`. */
export function urlServeur(): string {
  const fixe = new URLSearchParams(location.search).get('reco');
  return (fixe ?? `https://${location.hostname}:${PORT_SERVEUR}`).replace(/\/$/, '');
}

export class ErreurReco extends Error {}

/** Réglages de correction envoyés au serveur (le mode change le prompt, pas le format de réponse). */
export interface OptionsCorrection {
  mode: 'tout' | 'sans_solution' | 'indice' | 'resultat_final';
  zone: 'feuille' | 'selection';
  ton: 'bref' | 'detaille';
  enonce?: string;
  /** Photos de l'énoncé (data URL JPEG), lues par Claude avec la feuille. */
  photos?: string[];
  /** Énoncés des exercices posés sur la feuille (page de cours) avec leur zone de réponse. */
  blocs?: { numero?: number; enonce: string; zone: [number, number, number, number] }[];
  /** Empreintes des lignes déjà corrigées : le serveur ne refait que les lignes nouvelles ou modifiées. */
  deja_corrigees?: string[];
  /** Ce que l'élève a précisé sur certaines lignes : Claude en tient compte et ne le conteste pas. */
  precisions?: { empreinte: string; texte: string }[];
}

/** `?ignorer=%231a56db` dans l'URL de l'app ignore les traits de cette couleur (essais sur une feuille corrigée à la main). */
function options(o: OptionsCorrection): Record<string, unknown> {
  const ignorer = new URLSearchParams(location.search).get('ignorer');
  return { ...o, ...(ignorer ? { ignorer_couleurs: ignorer.split(',').filter(Boolean) } : {}) };
}

/** Envoie la feuille au serveur local : lecture par TexTeller puis correction par Claude. */
export async function corrigerFeuille(feuille: FeuilleLegere, reglages: OptionsCorrection): Promise<Resultat> {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), DELAI_MS);
  try {
    const rep = await fetch(`${urlServeur()}/corriger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...feuille, options: options(reglages) }),
      signal: ctrl.signal,
    });
    const corps = (await rep.json().catch(() => ({}))) as {
      entree?: string;
      groupes?: GroupeLu[];
      empreintes?: string[];
      explications?: { groupe: string; texte: string }[];
      annotations?: Annotation[];
      erreur_correction?: string;
      rien_de_nouveau?: boolean;
      correction?: { duree_s?: number; tentatives?: TentativeServeur[] };
      erreur?: string;
    };
    if (!rep.ok) throw new ErreurReco(corps.erreur ?? `erreur ${rep.status}`);
    return {
      entree: corps.entree,
      groupes: corps.groupes ?? [],
      empreintes: corps.empreintes,
      explications: corps.explications,
      annotations: corps.annotations ?? [],
      erreurCorrection: corps.erreur_correction,
      rienDeNouveau: corps.rien_de_nouveau,
      dureeCorrection: corps.correction?.duree_s,
      tentatives: corps.correction?.tentatives,
    };
  } catch (e) {
    if (e instanceof ErreurReco) throw e;
    if (e instanceof DOMException && e.name === 'AbortError') throw new ErreurReco('délai dépassé');
    throw new ErreurReco('serveur de lecture injoignable (le lancer sur le PC : npm run reco)');
  } finally {
    clearTimeout(minuteur);
  }
}

/** Résumé d'une lecture en arrière-plan (le contenu lu reste en cache sur le serveur). */
export interface ResumeLecture {
  lus: number;
  cache: number;
  echecs: number;
  annulee: boolean;
  duree_s: number;
  /** Le serveur n'utilise pas de lecture d'avance (entrée « image ») : inutile de lui envoyer d'autres /lire. */
  inactif?: boolean;
}

/** Fait lire par le serveur les groupes pas encore lus ; `signal` permet d'annuler (le serveur s'arrête aussi à la requête suivante). */
export async function lireEnFond(feuille: FeuilleLegere, signal: AbortSignal): Promise<ResumeLecture> {
  const ignorer = new URLSearchParams(location.search).get('ignorer');
  const rep = await fetch(`${urlServeur()}/lire`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...feuille, options: ignorer ? { ignorer_couleurs: ignorer.split(',').filter(Boolean) } : {} }),
    signal,
  });
  if (!rep.ok) throw new ErreurReco(`erreur ${rep.status}`);
  return (await rep.json()) as ResumeLecture;
}

// --- Reprise : l'élève précise ce qu'il a écrit, répond à une lecture douteuse ou discute -----------------------------------
export interface Reprise {
  /** Réponse de Claude à l'élève. */
  message: string;
  /** Annotations à créer ou remplacer (une par ligne). */
  annotations: (Annotation & { empreinte: string })[];
  /** Lignes (empreintes) dont l'annotation doit disparaître. */
  retirer: string[];
  /** Explications à écrire sur la feuille, chacune sous la ligne d'empreinte donnée. */
  explications?: { empreinte: string; texte: string }[];
  /** Position des lignes concernées. */
  groupes: { empreinte: string; id: string; x0: number; y0: number; x1: number; y1: number }[];
  lecture_corrigee?: string;
  /** Tokens et coût de l'appel (voir usage.ts). */
  tentatives?: TentativeServeur[];
}

export interface ParamsReprise {
  precision?: { empreinte: string; texte: string; lu?: string; propose?: string };
  message?: string;
  cibles?: string[];
  zone_traits?: string[];
  annotations_actuelles: { empreinte: string; type: string; note?: string; extrait?: string; lu?: string; propose?: string }[];
  precisions: { empreinte: string; texte: string }[];
  historique?: { role: 'eleve' | 'tuteur'; texte: string }[];
}

/** Un échange avec le tuteur : renvoie sa réponse et la mise à jour des annotations (le serveur ne garde pas de conversation). */
export async function discuter(feuille: FeuilleLegere, reglages: OptionsCorrection, params: ParamsReprise): Promise<Reprise> {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), 180_000);
  try {
    const rep = await fetch(`${urlServeur()}/discuter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...feuille, options: { ...options(reglages), zone: 'feuille', ...params } }),
      signal: ctrl.signal,
    });
    const corps = (await rep.json().catch(() => ({}))) as Partial<Reprise> & { erreur?: string; meta?: { tentatives?: TentativeServeur[] } };
    if (!rep.ok) throw new ErreurReco(corps.erreur ?? `erreur ${rep.status}`);
    return { message: corps.message ?? '', annotations: corps.annotations ?? [], retirer: corps.retirer ?? [], explications: corps.explications ?? [], groupes: corps.groupes ?? [], lecture_corrigee: corps.lecture_corrigee, tentatives: corps.meta?.tentatives };
  } catch (e) {
    if (e instanceof ErreurReco) throw e;
    if (e instanceof DOMException && e.name === 'AbortError') throw new ErreurReco('délai dépassé');
    throw new ErreurReco('serveur injoignable (le lancer sur le PC : npm run reco)');
  } finally {
    clearTimeout(minuteur);
  }
}

// --- Cours généré par Claude -------------------------------------------------------------------------------------------
export interface ParamsCours {
  mode: 'creer' | 'modifier';
  niveau: string;
  /** creer */
  notion?: string;
  longueur?: 'court' | 'moyen' | 'long';
  nb_exercices?: number;
  precisions?: string;
  /** modifier */
  cours?: { titre: string; sections: { titre: string; texte: string }[]; exercices: { difficulte: number; enonce: string }[] };
  demande?: string;
  historique?: { role: 'eleve' | 'tuteur'; texte: string }[];
  /** Photos jointes (data URL) : énoncé, extrait de cours… */
  photos?: string[];
}

export interface ReponseCours {
  message: string;
  titre: string;
  sections: { titre: string; texte: string }[];
  exercices: { enonce: string; difficulte: number; indice: string; solution: string }[];
}

/** Crée un cours ou répond à une demande sur un cours existant (le serveur ne garde rien : tout le contexte part à chaque appel). */
export async function elaborerCours(params: ParamsCours): Promise<ReponseCours> {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), 300_000);
  try {
    const rep = await fetch(`${urlServeur()}/cours`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ options: params }),
      signal: ctrl.signal,
    });
    const corps = (await rep.json().catch(() => ({}))) as Partial<ReponseCours> & { erreur?: string; erreur_cours?: string };
    if (!rep.ok) throw new ErreurReco(corps.erreur ?? `erreur ${rep.status}`);
    if (corps.erreur_cours) throw new ErreurReco(corps.erreur_cours);
    return { message: corps.message ?? '', titre: corps.titre ?? '', sections: corps.sections ?? [], exercices: corps.exercices ?? [] };
  } catch (e) {
    if (e instanceof ErreurReco) throw e;
    if (e instanceof DOMException && e.name === 'AbortError') throw new ErreurReco('délai dépassé');
    throw new ErreurReco('serveur injoignable (le lancer sur le PC : npm run reco)');
  } finally {
    clearTimeout(minuteur);
  }
}
