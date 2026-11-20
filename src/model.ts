/** [x, y, pression, t] : x,y en coordonnées de la feuille, t en ms (epoch). */
export type Point = [number, number, number, number];

export type Outil = 'stylo' | 'gomme' | 'lasso';
export type Fond = 'blanc' | 'carreaux' | 'ligne';

export interface Trait {
  id: string;
  couleur: string;
  epaisseur: number;
  outil: Outil;
  debut: number;
  fin: number;
  points: Point[];
}

/** Largeur logique de la feuille (façon A4) ; la hauteur est infinie. */
export const LARGEUR_FEUILLE = 800;
/** Hauteur minimale : proportions A4. */
export const HAUTEUR_MIN = Math.round((LARGEUR_FEUILLE * 297) / 210);
/** Espace laissé sous le dernier trait. */
export const MARGE_BAS = 600;

export function nouvelId(): string {
  return crypto.randomUUID();
}

/** Feuille entière telle qu'exportée en JSON. */
export interface Feuille {
  version: 1;
  largeur: number;
  fond: Fond;
  traits: Trait[];
  /** Énoncé de l'exercice (texte libre, facultatif) : aide la correction. */
  enonce?: string;
}

export const ENONCE_MAX = 4000;

export function versFeuille(traits: Trait[], fond: Fond, enonce = ''): Feuille {
  return { version: 1, largeur: LARGEUR_FEUILLE, fond, traits, ...(enonce ? { enonce } : {}) };
}

/**
 * Format léger envoyé au serveur de lecture : seulement ce qui sert à regrouper et rendre (x, y au dixième, début/fin du trait).
 * ~4× plus petit que l'export complet ; la même fonction sert à /lire et /corriger pour que les empreintes de groupes coïncident.
 */
export function versFeuilleLegere(traits: Iterable<Trait>, fond: Fond, enonce = '') {
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    version: 1,
    largeur: LARGEUR_FEUILLE,
    fond,
    ...(enonce ? { enonce } : {}),
    traits: [...traits]
      .filter((t) => t.outil === 'stylo')
      .map((t) => ({ id: t.id, couleur: t.couleur, epaisseur: t.epaisseur, outil: t.outil, debut: t.debut, fin: t.fin, points: t.points.map((p) => [r1(p[0]), r1(p[1])]) })),
  };
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function lireTrait(raw: unknown, k: number): Trait {
  if (typeof raw !== 'object' || raw === null) throw new Error(`trait ${k} invalide`);
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.points)) throw new Error(`trait ${k} : pas de points`);
  const debut = num(o.debut, 0);
  const points: Point[] = [];
  for (const p of o.points) {
    if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
      points.push([p[0], p[1], num(p[2], 0.5), num(p[3], debut)]);
    }
  }
  if (points.length === 0) throw new Error(`trait ${k} : aucun point valide`);
  return {
    id: typeof o.id === 'string' ? o.id : nouvelId(),
    couleur: typeof o.couleur === 'string' ? o.couleur : '#111111',
    epaisseur: num(o.epaisseur, 2),
    outil: o.outil === 'gomme' || o.outil === 'lasso' ? o.outil : 'stylo',
    debut,
    fin: num(o.fin, debut),
    points,
  };
}

/** Valide un JSON de feuille (import ou lecture de la base) ; lève une erreur lisible sinon. */
export function lireFeuille(raw: unknown): Feuille {
  if (typeof raw !== 'object' || raw === null) throw new Error('ce n\'est pas une feuille');
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.traits)) throw new Error('liste « traits » absente');
  const traits = o.traits.map(lireTrait);
  // Feuille exportée avec une autre largeur logique : on la remet à l'échelle.
  const k = typeof o.largeur === 'number' && o.largeur > 0 ? LARGEUR_FEUILLE / o.largeur : 1;
  if (k !== 1) {
    for (const t of traits) {
      t.epaisseur *= k;
      for (const p of t.points) {
        p[0] *= k;
        p[1] *= k;
      }
    }
  }
  const fond: Fond = o.fond === 'carreaux' || o.fond === 'ligne' ? o.fond : 'blanc';
  const enonce = typeof o.enonce === 'string' ? o.enonce.slice(0, ENONCE_MAX) : undefined;
  return { version: 1, largeur: LARGEUR_FEUILLE, fond, traits, ...(enonce ? { enonce } : {}) };
}
