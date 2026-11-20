import type { Viewport } from '../viewport';

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface LayerOpts {
  desynchronized?: boolean;
  /** Calque vide au repos : on n'alloue pas de mémoire tant qu'il n'est pas utilisé. */
  enabled?: boolean;
}

/**
 * Calque = canvas net sur écrans Retina (devicePixelRatio). Il peut déborder
 * de l'écran (marge mx/my) pour que le défilement ne révèle pas de vide.
 */
export class Layer {
  readonly canvas = document.createElement('canvas');
  readonly ctx: CanvasRenderingContext2D;
  width = 0; // taille de l'écran, px CSS
  height = 0;
  mx = 0;
  my = 0;
  dpr = 1;
  enabled: boolean;

  constructor(parent: HTMLElement, opts: LayerOpts = {}) {
    this.enabled = opts.enabled ?? true;
    this.ctx = this.canvas.getContext('2d', {
      desynchronized: opts.desynchronized ?? false,
    })!;
    parent.appendChild(this.canvas);
  }

  resize(w: number, h: number, dpr: number, mx = 0, my = 0) {
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.mx = mx;
    this.my = my;
    const cw = w + 2 * mx;
    const ch = h + 2 * my;
    const s = this.canvas.style;
    s.left = `${-mx}px`;
    s.top = `${-my}px`;
    s.width = `${cw}px`;
    s.height = `${ch}px`;
    this.canvas.width = this.enabled ? Math.round(cw * dpr) : 1;
    this.canvas.height = this.enabled ? Math.round(ch * dpr) : 1;
  }

  clear() {
    const { ctx, canvas } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  /** Repère feuille → pixels device. */
  applyViewport(vp: { scale: number; tx: number; ty: number }) {
    const d = this.dpr;
    this.ctx.setTransform(vp.scale * d, 0, 0, vp.scale * d, (vp.tx + this.mx) * d, (vp.ty + this.my) * d);
  }

  /** Zone de la feuille couverte par ce canvas (marges comprises). */
  visibleRect(vp: { scale: number; tx: number; ty: number }): Rect {
    return {
      x0: (-this.mx - vp.tx) / vp.scale,
      y0: (-this.my - vp.ty) / vp.scale,
      x1: (this.width + this.mx - vp.tx) / vp.scale,
      y1: (this.height + this.my - vp.ty) / vp.scale,
    };
  }
}

export type { Viewport };
