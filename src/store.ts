import type { Trait } from './model';
import { invalidate } from './render/ink';

interface Cmd {
  do(): void;
  undo(): void;
}

/** La feuille (liste de traits) et son historique annuler/rétablir. */
export class Store {
  traits: Trait[] = [];
  /** Appelé après toute modification de la feuille (sauvegarde automatique). */
  onChange: () => void = () => {};
  private past: Cmd[] = [];
  private future: Cmd[] = [];

  private exec(c: Cmd) {
    c.do();
    this.past.push(c);
    this.future.length = 0;
    this.onChange();
  }

  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }

  /** Charge une feuille au démarrage : ni historique, ni sauvegarde. */
  charger(traits: Trait[]) {
    this.traits = traits;
    this.past = [];
    this.future = [];
  }

  /** Remplace toute la feuille (import) ; annulable. */
  remplacer(traits: Trait[]) {
    const avant = this.traits;
    this.exec({ do: () => (this.traits = traits), undo: () => (this.traits = avant) });
  }

  add(t: Trait) {
    this.exec({
      do: () => this.traits.push(t),
      undo: () => {
        this.traits.splice(this.traits.lastIndexOf(t), 1);
      },
    });
  }

  removeMany(ts: Trait[]) {
    const set = new Set(ts);
    const items = this.traits.map((t, i) => [i, t] as const).filter(([, t]) => set.has(t));
    if (items.length === 0) return;
    this.exec({
      do: () => {
        this.traits = this.traits.filter((t) => !set.has(t));
      },
      undo: () => {
        for (const [i, t] of items) this.traits.splice(i, 0, t); // indices croissants
      },
    });
  }

  moveMany(ts: Trait[], dx: number, dy: number) {
    const shift = (sx: number, sy: number) => {
      for (const t of ts) {
        for (const p of t.points) {
          p[0] += sx;
          p[1] += sy;
        }
        invalidate(t);
      }
    };
    this.exec({ do: () => shift(dx, dy), undo: () => shift(-dx, -dy) });
  }

  /** Décale des traits vers le bas (« + de place ») sans toucher à l'historique : les blocs de la page ne s'annulent pas avec eux. */
  decaler(ts: Trait[], dy: number) {
    if (ts.length === 0) return;
    for (const t of ts) {
      for (const p of t.points) p[1] += dy;
      invalidate(t);
    }
    this.onChange();
  }

  undo(): boolean {
    const c = this.past.pop();
    if (!c) return false;
    c.undo();
    this.future.push(c);
    this.onChange();
    return true;
  }

  redo(): boolean {
    const c = this.future.pop();
    if (!c) return false;
    c.do();
    this.past.push(c);
    this.onChange();
    return true;
  }
}
