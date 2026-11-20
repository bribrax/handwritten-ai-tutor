import { getStroke } from 'perfect-freehand';
import type { Point, Trait } from '../model';
import type { Rect } from './layers';

/** Trait trop court pour perfect-freehand (point sur un i...) : capsule à bouts ronds. */
function capsule(points: Point[], epaisseur: number): Path2D {
  const a = points[0];
  const b = points[points.length - 1];
  const p = points.reduce((m, q) => m + q[2], 0) / points.length;
  const r = epaisseur * (0.25 + 0.5 * p); // même rayon que perfect-freehand (thinning 0.5)
  const path = new Path2D();
  path.arc(a[0], a[1], r, 0, Math.PI * 2);
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (d > 0.01) {
    path.arc(b[0], b[1], r, 0, Math.PI * 2);
    const nx = ((-(b[1] - a[1])) / d) * r;
    const ny = ((b[0] - a[0]) / d) * r;
    // sens horaire, comme les arcs, pour ne pas créer de trou (règle nonzero)
    path.moveTo(a[0] - nx, a[1] - ny);
    path.lineTo(b[0] - nx, b[1] - ny);
    path.lineTo(b[0] + nx, b[1] + ny);
    path.lineTo(a[0] + nx, a[1] + ny);
    path.closePath();
  }
  return path;
}

function longueur(points: Point[]): number {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return l;
}

/** Contour perfect-freehand → Path2D (courbes quadratiques entre milieux). */
export function strokePath(points: Point[], epaisseur: number, complet: boolean): Path2D {
  if (points.length === 0) return new Path2D();
  if (longueur(points) < epaisseur * 2.5) return capsule(points, epaisseur);
  const outline = getStroke(
    points.map(([x, y, p]) => [x, y, p]),
    {
      size: epaisseur,
      thinning: 0.5,
      smoothing: 0.4,
      streamline: 0.2,
      simulatePressure: false,
      last: complet,
    },
  );
  const path = new Path2D();
  const n = outline.length;
  if (n < 3) return capsule(points, epaisseur);
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 0; i < n; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % n];
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  path.closePath();
  return path;
}

// Caches de rendu : jamais sauvegardés, recalculables à tout moment.
const paths = new WeakMap<Trait, Path2D>();
const boxes = new WeakMap<Trait, Rect>();

export function pathOf(t: Trait): Path2D {
  let p = paths.get(t);
  if (!p) {
    p = strokePath(t.points, t.epaisseur, true);
    paths.set(t, p);
  }
  return p;
}

export function bboxOf(t: Trait): Rect {
  let b = boxes.get(t);
  if (!b) {
    b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const [x, y] of t.points) {
      if (x < b.x0) b.x0 = x;
      if (y < b.y0) b.y0 = y;
      if (x > b.x1) b.x1 = x;
      if (y > b.y1) b.y1 = y;
    }
    const pad = t.epaisseur;
    b.x0 -= pad;
    b.y0 -= pad;
    b.x1 += pad;
    b.y1 += pad;
    boxes.set(t, b);
  }
  return b;
}

/** À appeler quand les points d'un trait changent (déplacement au lasso). */
export function invalidate(t: Trait) {
  paths.delete(t);
  boxes.delete(t);
}

export function drawTrait(ctx: CanvasRenderingContext2D, t: Trait) {
  ctx.fillStyle = t.couleur;
  ctx.fill(pathOf(t));
}

export interface DrawOpts {
  /** Traits masqués (gomme en cours). */
  hidden?: Set<Trait>;
  /** Traits sélectionnés : halo bleu, et décalage (dx, dy) pendant un déplacement. */
  selected?: Set<Trait>;
  dx?: number;
  dy?: number;
}

/** Ne dessine que les traits dont la bbox touche la zone visible. */
export function drawVisible(ctx: CanvasRenderingContext2D, traits: Trait[], r: Rect, o: DrawOpts = {}) {
  for (const t of traits) {
    if (o.hidden?.has(t)) continue;
    if (o.selected?.has(t)) {
      ctx.save();
      ctx.translate(o.dx ?? 0, o.dy ?? 0);
      ctx.strokeStyle = 'rgba(60, 130, 255, 0.4)';
      ctx.lineWidth = t.epaisseur * 3;
      ctx.lineJoin = 'round';
      ctx.stroke(pathOf(t));
      drawTrait(ctx, t);
      ctx.restore();
      continue;
    }
    const b = bboxOf(t);
    if (b.x1 < r.x0 || b.x0 > r.x1 || b.y1 < r.y0 || b.y0 > r.y1) continue;
    drawTrait(ctx, t);
  }
}

export function drawLiveStroke(ctx: CanvasRenderingContext2D, points: Point[], couleur: string, epaisseur: number) {
  if (points.length === 0) return;
  ctx.fillStyle = couleur;
  ctx.fill(strokePath(points, epaisseur, false));
}
