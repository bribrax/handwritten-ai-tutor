import type { Point } from '../model';

// Réglages de reconnaissance (unités feuille ≈ px à l'échelle 1).
const CORDE_MIN = 20; // sinon : point, ou boucle fermée
const LONGUEUR_MIN = 40;
const DETOUR_MAX = 2.5; // longueur du tracé / corde : au-delà, c'est une boucle ou un zigzag
const ECART_DROITE = 0.07; // écart max à la corde, en fraction de la corde
const ECART_COURBE = 0.06; // erreur RMS max de l'ajustement de Bézier

type Pt = [number, number];

export type Forme = { type: 'droite' } | { type: 'courbe'; ctrl: Pt };

/** Droite ou courbe de Bézier quadratique si le tracé en est assez proche, sinon null. */
export function reconnaitre(points: Point[]): Forme | null {
  if (points.length < 3) return null;
  const a = points[0];
  const b = points[points.length - 1];
  const corde = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (corde < CORDE_MIN) return null;

  // Paramétrage par longueur cumulée.
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  const L = cum[cum.length - 1];
  if (L < LONGUEUR_MIN || L > DETOUR_MAX * corde) return null;

  // Écart maximal à la droite (a, b).
  const ux = (b[0] - a[0]) / corde;
  const uy = (b[1] - a[1]) / corde;
  let ecart = 0;
  for (const p of points) ecart = Math.max(ecart, Math.abs((p[0] - a[0]) * uy - (p[1] - a[1]) * ux));
  if (ecart <= Math.max(3, ECART_DROITE * corde)) return { type: 'droite' };

  // Ajustement aux moindres carrés du point de contrôle P1.
  let nx = 0;
  let ny = 0;
  let den = 0;
  const ts = cum.map((c) => c / L);
  points.forEach((p, i) => {
    const t = ts[i];
    const b0 = (1 - t) * (1 - t);
    const b1 = 2 * t * (1 - t);
    const b2 = t * t;
    nx += b1 * (p[0] - b0 * a[0] - b2 * b[0]);
    ny += b1 * (p[1] - b0 * a[1] - b2 * b[1]);
    den += b1 * b1;
  });
  if (den === 0) return null;
  const ctrl: Pt = [nx / den, ny / den];

  let err = 0;
  points.forEach((p, i) => {
    const t = ts[i];
    const b0 = (1 - t) * (1 - t);
    const b1 = 2 * t * (1 - t);
    const b2 = t * t;
    const x = b0 * a[0] + b1 * ctrl[0] + b2 * b[0];
    const y = b0 * a[1] + b1 * ctrl[1] + b2 * b[1];
    err += (p[0] - x) ** 2 + (p[1] - y) ** 2;
  });
  if (Math.sqrt(err / points.length) > ECART_COURBE * corde + 1) return null;
  return { type: 'courbe', ctrl };
}

/** Points de la forme, de `a` à `b`, à pression constante (trait d'épaisseur uniforme). */
export function genere(forme: Forme, a: Pt, b: Pt, pression: number, t0: number, t1: number): Point[] {
  const long = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(8, Math.ceil(long / 4));
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let x: number;
    let y: number;
    if (forme.type === 'droite') {
      x = a[0] + (b[0] - a[0]) * t;
      y = a[1] + (b[1] - a[1]) * t;
    } else {
      const b0 = (1 - t) * (1 - t);
      const b1 = 2 * t * (1 - t);
      const b2 = t * t;
      x = b0 * a[0] + b1 * forme.ctrl[0] + b2 * b[0];
      y = b0 * a[1] + b1 * forme.ctrl[1] + b2 * b[1];
    }
    out.push([x, y, pression, Math.round(t0 + (t1 - t0) * t)]);
  }
  return out;
}
