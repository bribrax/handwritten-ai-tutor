import type { Viewport } from '../viewport';

/** Un contact tactile plus large que ça (px CSS) est une paume, pas un doigt. */
const MAX_CONTACT = 115;
/** Après un trait, on ignore les doigts un instant (la paume se relève). */
const PEN_GUARD_MS = 350;

export interface TouchHooks {
  onChange(): void;
  onEnd(): void;
  log?(s: string): void;
}

type Pt = [number, number];

/** 1 doigt = défilement, 2 doigts = pinch + déplacement. Incrémental. */
export function setupTouch(root: HTMLElement, vp: Viewport, hooks: TouchHooks) {
  const active = new Map<number, Pt>();
  const ignored = new Set<number>();
  let penDown = false;
  let penUntil = 0;

  const blocked = () => penDown || performance.now() < penUntil;

  function stats(): { c: Pt; d: number } {
    const pts = [...active.values()];
    const c: Pt = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
    const d = pts.length === 2 ? Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) : 0;
    return { c, d };
  }

  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    e.preventDefault();
    const palm = e.width > MAX_CONTACT || e.height > MAX_CONTACT;
    hooks.log?.(`touch ${e.width.toFixed(0)}x${e.height.toFixed(0)}${palm ? ' PAUME' : ''}${blocked() ? ' (stylet)' : ''}`);
    if (blocked() || palm || active.size >= 2) {
      ignored.add(e.pointerId);
      return;
    }
    active.set(e.pointerId, [e.clientX, e.clientY]);
  });

  root.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch') return;
    if (!active.has(e.pointerId)) return;
    e.preventDefault();
    if (blocked()) return cancel();
    // Un contact qui s'élargit en cours de route devient une paume.
    if (e.width > MAX_CONTACT || e.height > MAX_CONTACT) {
      ignored.add(e.pointerId);
      active.delete(e.pointerId);
      if (active.size === 0) hooks.onEnd();
      return;
    }
    const before = stats();
    active.set(e.pointerId, [e.clientX, e.clientY]);
    const after = stats();
    const factor = active.size === 2 && before.d > 0 ? after.d / before.d : 1;
    vp.pinch(before.c, after.c, factor);
    hooks.onChange();
  });

  function release(e: PointerEvent) {
    if (e.pointerType !== 'touch') return;
    ignored.delete(e.pointerId);
    if (active.delete(e.pointerId) && active.size === 0) hooks.onEnd();
  }
  root.addEventListener('pointerup', release);
  root.addEventListener('pointercancel', release);

  /** Annule tout geste en cours ; les doigts encore posés sont ignorés jusqu'à leur relevé. */
  function cancel() {
    if (active.size === 0) return;
    for (const id of active.keys()) ignored.add(id);
    active.clear();
    hooks.onEnd();
  }

  return {
    cancel,
    setPen(down: boolean) {
      penDown = down;
      if (down) cancel();
      else penUntil = performance.now() + PEN_GUARD_MS;
    },
  };
}
