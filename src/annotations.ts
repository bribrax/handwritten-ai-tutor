import { get, set } from 'idb-keyval';
import type { Trait } from './model';
import { cle } from './pages';
import type { Rect } from './render/layers';
import { bboxOf } from './render/ink';
import type { Annotation, Resultat, Reprise } from './reco';

/** Annotation posée sur la feuille (coordonnées feuille). Séparée des traits de l'élève. */
export interface ItemAnnotation {
  id: string;
  type: Exclude<Annotation['type'], 'remarque_generale'>;
  groupe: string;
  /** Identifie la ligne (voir reco.ts). Absente sur les annotations posées avant cette version : on ne peut pas y répondre. */
  empreinte?: string;
  bbox: [number, number, number, number];
  /** LaTeX lu pour la ligne au moment de la correction. */
  latex: string;
  note?: string;
  extrait?: string;
  lu?: string;
  propose?: string;
  verifiee?: boolean;
  /** Graine du tremblé : le dessin reste identique à chaque redessin. */
  graine: number;
  /** Traits (id + position) sous la boîte quand l'annotation a été posée. */
  signature: string;
  /** Les traits sous la boîte ont changé depuis : l'annotation est estompée. */
  estompee: boolean;
}

export interface EtatAnnotations {
  visibles: boolean;
  items: ItemAnnotation[];
  /** Remarques générales (affichées dans le panneau seulement). */
  remarques: string[];
  /** Empreintes de toutes les lignes vues lors des corrections : ce qui n'a pas changé depuis n'est pas refait (voir deja()). */
  vues?: string[];
}

const MARGE_SIGNATURE = 4; // unités feuille autour de la boîte du groupe

export const etat: EtatAnnotations = { visibles: true, items: [], remarques: [] };

function valide(raw: unknown): raw is EtatAnnotations {
  const o = raw as Partial<EtatAnnotations> | null;
  return !!o && typeof o.visibles === 'boolean' && Array.isArray(o.items) && Array.isArray(o.remarques);
}

/** Annotations de la page courante, sauvegardées lors d'une session précédente (état vide si la page n'en a pas). */
export async function chargerAnnotations(): Promise<void> {
  Object.assign(etat, { visibles: true, items: [], remarques: [], vues: undefined });
  try {
    const raw = await get(cle('annotations'));
    if (valide(raw)) Object.assign(etat, raw);
  } catch (e) {
    console.warn('Lecture des annotations impossible', e);
  }
}

export function sauverAnnotations(): void {
  set(cle('annotations'), JSON.parse(JSON.stringify(etat))).catch((e) => console.warn('Sauvegarde des annotations impossible', e));
}

/** Traits dont le centre tombe dans la boîte (même règle à la pose et à la vérification). */
export function signature(traits: Trait[], b: [number, number, number, number]): string {
  const [x0, y0, x1, y1] = [b[0] - MARGE_SIGNATURE, b[1] - MARGE_SIGNATURE, b[2] + MARGE_SIGNATURE, b[3] + MARGE_SIGNATURE];
  const sous: string[] = [];
  for (const t of traits) {
    const r = bboxOf(t);
    const cx = (r.x0 + r.x1) / 2;
    const cy = (r.y0 + r.y1) / 2;
    if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) sous.push(`${t.id}@${Math.round(r.x0)},${Math.round(r.y0)}`);
  }
  return sous.sort().join('|');
}

const recouvre = (b: [number, number, number, number], z: Rect) => b[0] <= z.x1 + 4 && b[2] >= z.x0 - 4 && b[1] <= z.y1 + 4 && b[3] >= z.y0 - 4;

/**
 * Pose les annotations d'une correction. Toute la feuille : elles remplacent les précédentes.
 * Une zone (sélection au lasso) : seules les annotations qui recouvrent la zone sont remplacées, les autres restent.
 */
export function poserAnnotations(res: Resultat, traits: Trait[], zone: Rect | null = null, inchangees: ReadonlySet<string> | null = null): void {
  const parId = new Map(res.groupes.map((g) => [g.id, g]));
  const items: ItemAnnotation[] = [];
  const remarques: string[] = [];
  for (const a of res.annotations) {
    if (a.type === 'remarque_generale') {
      if (a.note) remarques.push(a.note);
      continue;
    }
    const g = a.groupe ? parId.get(a.groupe) : undefined;
    if (!g) continue;
    const bbox: [number, number, number, number] = [g.x0, g.y0, g.x1, g.y1];
    items.push({
      id: crypto.randomUUID(),
      type: a.type,
      groupe: g.id,
      empreinte: g.empreinte,
      bbox,
      latex: g.latex,
      note: a.note,
      extrait: a.extrait,
      lu: a.lu,
      propose: a.propose,
      verifiee: a.verifiee,
      graine: Math.floor(Math.random() * 2 ** 31),
      signature: signature(traits, bbox),
      estompee: false,
    });
  }
  const presentes = res.empreintes ?? res.groupes.map((g) => g.empreinte).filter((e): e is string => !!e);
  if (zone) {
    etat.items = [...etat.items.filter((a) => !recouvre(a.bbox, zone)), ...items];
    etat.remarques = [...etat.remarques, ...remarques];
    etat.vues = [...new Set([...(etat.vues ?? []), ...presentes])];
  } else if (inchangees) {
    // Correction partielle : les lignes inchangées gardent leur annotation, les autres reçoivent la nouvelle.
    etat.items = [...etat.items.filter((a) => a.empreinte && inchangees.has(a.empreinte) && presentes.includes(a.empreinte)), ...items];
    etat.remarques = remarques.length ? remarques : etat.remarques;
    etat.vues = presentes;
  } else {
    etat.vues = presentes;
    etat.items = items;
    etat.remarques = remarques;
  }
  etat.visibles = true;
  sauverAnnotations();
}

/** Recalcule l'estompage (la feuille a changé) ; renvoie true si au moins une annotation a changé d'état. */
export function reevaluer(traits: Trait[]): boolean {
  let change = false;
  for (const a of etat.items) {
    const estompee = signature(traits, a.bbox) !== a.signature;
    if (estompee !== a.estompee) {
      a.estompee = estompee;
      change = true;
    }
  }
  if (change) sauverAnnotations();
  return change;
}

/** « + de place », explication écrite sous une ligne : les annotations sous `seuil` suivent leurs lignes (l'empreinte d'une ligne ne dépend pas de sa hauteur : le lien est conservé). */
export function decalerAnnotations(seuil: number, dy: number, traits: Trait[]): void {
  let change = false;
  for (const a of etat.items) {
    if (a.bbox[1] < seuil) continue;
    a.bbox = [a.bbox[0], a.bbox[1] + dy, a.bbox[2], a.bbox[3] + dy];
    a.signature = signature(traits, a.bbox);
    a.estompee = false;
    change = true;
  }
  if (change) sauverAnnotations();
}

export function effacerAnnotations(): void {
  etat.items = [];
  etat.remarques = [];
  etat.vues = [];
  sauverAnnotations();
}

export function basculerVisibilite(): boolean {
  etat.visibles = !etat.visibles;
  sauverAnnotations();
  return etat.visibles;
}

/** Applique la réponse de Claude : annotations remplacées ou créées, annotations retirées. Renvoie true si quelque chose a changé. */
export function appliquerReprise(rep: Reprise, traits: Trait[]): boolean {
  const parEmp = new Map(rep.groupes.map((g) => [g.empreinte, g]));
  const retirer = new Set(rep.retirer);
  const avant = etat.items.length;
  etat.items = etat.items.filter((a) => !(a.empreinte && retirer.has(a.empreinte)));
  let change = etat.items.length !== avant;
  for (const a of rep.annotations) {
    if (a.type === 'remarque_generale') continue;
    const g = parEmp.get(a.empreinte);
    if (!g) continue;
    const bbox: [number, number, number, number] = [g.x0, g.y0, g.x1, g.y1];
    const i = etat.items.findIndex((x) => x.empreinte === g.empreinte);
    const item: ItemAnnotation = {
      id: crypto.randomUUID(), type: a.type, groupe: g.id, empreinte: g.empreinte, bbox, latex: '', note: a.note, extrait: a.extrait, lu: a.lu, propose: a.propose,
      verifiee: a.verifiee, graine: i >= 0 ? etat.items[i].graine : Math.floor(Math.random() * 2 ** 31), signature: signature(traits, bbox), estompee: false,
    };
    if (i >= 0) etat.items[i] = item;
    else etat.items.push(item);
    change = true;
  }
  if (change) sauverAnnotations();
  return change;
}
