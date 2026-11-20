import type { ItemAnnotation } from '../annotations';
import type { Rect } from './layers';

export const COULEUR_ANNOTATION: Record<ItemAnnotation['type'], string> = {
  ok: '#16a34a',
  erreur: '#d92d20',
  indice: '#d97706',
  lecture_douteuse: '#7c3aed',
};

const ALPHA_ESTOMPEE = 0.25;

/** Générateur pseudo-aléatoire à graine (mulberry32) : même tremblé à chaque redessin. */
function aleatoire(graine: number) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ellipse à main levée : un peu plus d'un tour, rayon qui ondule et dérive, comme un cercle tracé vite. */
function ellipse(ctx: CanvasRenderingContext2D, [x0, y0, x1, y1]: ItemAnnotation['bbox'], rnd: () => number) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = ((x1 - x0) / 2) * 1.12 + 10;
  const ry = ((y1 - y0) / 2) * 1.3 + 8;
  const depart = rnd() * Math.PI * 2;
  const p1 = rnd() * 6;
  const p2 = rnd() * 6;
  const tours = 1.1 + rnd() * 0.08;
  const n = 72;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const th = depart + u * tours * Math.PI * 2;
    const k = 0.97 + 0.07 * u + 0.025 * Math.sin(2 * th + p1) + 0.015 * Math.sin(3 * th + p2);
    pts.push([cx + Math.cos(th) * rx * k, cy + Math.sin(th) * ry * k]);
  }
  courbe(ctx, pts);
}

/** Courbe lisse passant près des points (quadratiques entre milieux). */
function courbe(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const d = pts[pts.length - 1];
  ctx.lineTo(d[0], d[1]);
  ctx.stroke();
}

function coche(ctx: CanvasRenderingContext2D, x: number, y: number, rnd: () => number) {
  const j = () => (rnd() - 0.5) * 1.6;
  ctx.lineWidth = 3.2;
  courbe(ctx, [
    [x + j(), y + j()],
    [x + 4 + j(), y + 7 + j()],
    [x + 9 + j(), y + 11 + j()],
    [x + 17 + j(), y - 1 + j()],
    [x + 25 + j(), y - 12 + j()],
  ]);
}

/** Soulignement ondulé sous la ligne (indice, lecture douteuse). */
function soulignement(ctx: CanvasRenderingContext2D, [x0, , x1, y1]: ItemAnnotation['bbox'], rnd: () => number, pointille: boolean) {
  const y = y1 + 7;
  const p = rnd() * 6;
  const pts: [number, number][] = [];
  for (let x = x0 - 4; x <= x1 + 4; x += 6) pts.push([x, y + Math.sin(x / 7 + p) * 1.6 + (rnd() - 0.5)]);
  if (pts.length < 3) return;
  if (pointille) ctx.setLineDash([7, 5]);
  courbe(ctx, pts);
  ctx.setLineDash([]);
}

/** Dessine les annotations visibles dans le repère feuille (le contexte a déjà le bon viewport). */
export function dessinerAnnotations(ctx: CanvasRenderingContext2D, items: ItemAnnotation[], zone: Rect) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const a of items) {
    const [x0, y0, x1, y1] = a.bbox;
    if (x1 + 40 < zone.x0 || x0 - 20 > zone.x1 || y1 + 20 < zone.y0 || y0 - 20 > zone.y1) continue;
    const rnd = aleatoire(a.graine);
    ctx.globalAlpha = a.estompee ? ALPHA_ESTOMPEE : 1;
    ctx.strokeStyle = COULEUR_ANNOTATION[a.type];
    ctx.lineWidth = 2.4;
    if (a.type === 'erreur') ellipse(ctx, a.bbox, rnd);
    else if (a.type === 'ok') coche(ctx, Math.min(x1 + 14, 770), (y0 + y1) / 2 - 2, rnd);
    else soulignement(ctx, a.bbox, rnd, a.type === 'lecture_douteuse');
  }
  ctx.restore();
}
