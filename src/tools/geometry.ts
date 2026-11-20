import type { Trait } from '../model';
import { bboxOf } from '../render/ink';

function distPointSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

/** Le disque (x, y, r) touche-t-il le trait ? */
export function hitsStroke(t: Trait, x: number, y: number, r: number): boolean {
  const b = bboxOf(t);
  if (x < b.x0 - r || x > b.x1 + r || y < b.y0 - r || y > b.y1 + r) return false;
  const reach = r + t.epaisseur / 2;
  const pts = t.points;
  if (pts.length === 1) return Math.hypot(x - pts[0][0], y - pts[0][1]) <= reach;
  for (let i = 1; i < pts.length; i++) {
    if (distPointSeg(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= reach) return true;
  }
  return false;
}

/** Traits touchés par un disque qui se déplace de `from` à `to` (échantillonné). */
export function sweepHits(
  traits: Trait[],
  skip: Set<Trait>,
  from: [number, number],
  to: [number, number],
  r: number,
): Trait[] {
  const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / (r / 2)));
  const hits: Trait[] = [];
  for (let i = 1; i <= steps; i++) {
    const x = from[0] + ((to[0] - from[0]) * i) / steps;
    const y = from[1] + ((to[1] - from[1]) * i) / steps;
    for (const t of traits) {
      if (!skip.has(t) && !hits.includes(t) && hitsStroke(t, x, y, r)) hits.push(t);
    }
  }
  return hits;
}

export function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Traits dont au moins la moitié des points sont dans le lasso. */
export function selectInside(traits: Trait[], poly: [number, number][]): Trait[] {
  if (poly.length < 3) return [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return traits.filter((t) => {
    const b = bboxOf(t);
    if (b.x1 < x0 || b.x0 > x1 || b.y1 < y0 || b.y0 > y1) return false;
    let dedans = 0;
    for (const p of t.points) if (pointInPolygon(p[0], p[1], poly)) dedans++;
    return dedans * 2 >= t.points.length;
  });
}
