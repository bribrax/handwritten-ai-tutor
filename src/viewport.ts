import { HAUTEUR_MIN, LARGEUR_FEUILLE } from './model';

/** Transformation feuille → écran (px CSS) : écran = feuille * scale + t. */
export class Viewport {
  scale = 1;
  tx = 0;
  ty = 0;
  /** Hauteur courante de la feuille (unités feuille). */
  sheetH = HAUTEUR_MIN;
  W = 0;
  H = 0;
  fit = 1;
  private init = false;

  get minScale() {
    return this.fit * 0.5;
  }
  get maxScale() {
    return this.fit * 5;
  }

  setScreen(w: number, h: number) {
    const ratio = this.init ? this.scale / this.fit : 1;
    this.W = w;
    this.H = h;
    const marge = w > 900 ? 48 : 0;
    this.fit = (w - marge * 2) / LARGEUR_FEUILLE;
    this.scale = this.fit * ratio;
    this.init = true;
    this.clamp();
  }

  clamp() {
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, this.scale));
    const sw = LARGEUR_FEUILLE * this.scale;
    this.tx = sw <= this.W ? (this.W - sw) / 2 : Math.min(0, Math.max(this.W - sw, this.tx));
    const sh = this.sheetH * this.scale;
    this.ty = sh <= this.H ? 0 : Math.min(0, Math.max(this.H - sh, this.ty));
  }

  /** Le point de la feuille sous `from` (écran) se retrouve sous `to`, avec zoom `factor`. */
  pinch(from: [number, number], to: [number, number], factor: number) {
    const px = (from[0] - this.tx) / this.scale;
    const py = (from[1] - this.ty) / this.scale;
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
    this.tx = to[0] - px * this.scale;
    this.ty = to[1] - py * this.scale;
    this.clamp();
  }

  toSheet(clientX: number, clientY: number): [number, number] {
    return [(clientX - this.tx) / this.scale, (clientY - this.ty) / this.scale];
  }
}
