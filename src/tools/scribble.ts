import type { Point, Trait } from '../model';
import { bboxOf } from '../render/ink';

// Réglages de détection (unités feuille ≈ px à l'échelle 1).
const PAS = 4; // rééchantillonnage
const AMPLITUDE_MIN = 8; // un aller-retour plus petit est du bruit
const REBROUSSEMENTS_MIN = 5; // ≥ 3 allers-retours
const RATIO_MIN = 3; // longueur du tracé / diagonale : un gribouillis est dense
const LONGUEUR_MIN = 80;
const TAILLE_MAX = 600;
const COUVERTURE_MIN = 0.6;

type Pt = [number, number];

function reechantillonne(points: Point[], pas: number): Pt[] {
  const out: Pt[] = [[points[0][0], points[0][1]]];
  for (const p of points) {
    const l = out[out.length - 1];
    if (Math.hypot(p[0] - l[0], p[1] - l[1]) >= pas) out.push([p[0], p[1]]);
  }
  return out;
}

/** Nombre de changements de sens d'une courbe 1D, avec hystérésis. */
function rebroussements(v: number[], amplitude: number): number {
  let cand = v[0];
  let dir = 0;
  let n = 0;
  for (const x of v) {
    if (dir === 0) {
      if (Math.abs(x - cand) >= amplitude) {
        dir = x > cand ? 1 : -1;
        cand = x;
      }
    } else if (dir === 1) {
      if (x > cand) cand = x;
      else if (cand - x >= amplitude) {
        n++;
        dir = -1;
        cand = x;
      }
    } else if (x < cand) cand = x;
    else if (x - cand >= amplitude) {
      n++;
      dir = 1;
      cand = x;
    }
  }
  return n;
}

function distSeg(px: number, py: number, a: Pt, b: Pt): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const l2 = vx * vx + vy * vy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * vx + (py - a[1]) * vy) / l2));
  return Math.hypot(px - (a[0] + t * vx), py - (a[1] + t * vy));
}

/**
 * Si `scribble` est un gribouillis, renvoie les traits qu'il raye (au moins un) ;
 * sinon une liste vide, et le trait reste un trait ordinaire.
 */
export function trouverCibles(scribble: Trait, traits: Trait[]): Trait[] {
  if (scribble.points.length < 12) return [];
  const pts = reechantillonne(scribble.points, PAS);
  if (pts.length < 20) return [];

  let longueur = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) longueur += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    x0 = Math.min(x0, pts[i][0]);
    y0 = Math.min(y0, pts[i][1]);
    x1 = Math.max(x1, pts[i][0]);
    y1 = Math.max(y1, pts[i][1]);
  }
  const w = x1 - x0;
  const h = y1 - y0;
  const diag = Math.hypot(w, h);
  if (longueur < LONGUEUR_MIN || Math.max(w, h) > TAILLE_MAX || longueur / Math.max(diag, 1) < RATIO_MIN) return [];

  // Va-et-vient le long de l'un des axes.
  const rb = Math.max(
    rebroussements(pts.map((p) => p[0]), AMPLITUDE_MIN),
    rebroussements(pts.map((p) => p[1]), AMPLITUDE_MIN),
  );
  if (rb < REBROUSSEMENTS_MIN) return [];

  // Écart moyen entre les passages du gribouillis → distance de couverture.
  const espacement = (Math.max(w, 1) * Math.max(h, 1)) / longueur;
  const d = Math.min(28, Math.max(7, 0.6 * espacement + 4));

  const cibles: Trait[] = [];
  for (const t of traits) {
    if (t === scribble) continue;
    const b = bboxOf(t);
    if (b.x1 < x0 - d || b.x0 > x1 + d || b.y1 < y0 - d || b.y0 > y1 + d) continue;
    const pas = Math.max(1, Math.floor(t.points.length / 40));
    let total = 0;
    let couverts = 0;
    for (let i = 0; i < t.points.length; i += pas) {
      total++;
      const [px, py] = t.points[i];
      for (let j = 1; j < pts.length; j++) {
        if (distSeg(px, py, pts[j - 1], pts[j]) <= d) {
          couverts++;
          break;
        }
      }
    }
    if (total > 0 && couverts / total >= COUVERTURE_MIN) cibles.push(t);
  }
  return cibles;
}
