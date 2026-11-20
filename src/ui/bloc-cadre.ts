import { LARGEUR_BLOC_MIN, type Bloc } from '../blocs';
import { LARGEUR_FEUILLE } from '../model';
import type { Viewport } from '../viewport';

export type ActionBloc = 'indice' | 'solution' | 'place' | 'supprimer' | 'fermer';

export interface CadreBlocHooks {
  /** Position/largeur modifiée pendant le geste (aperçu immédiat, pas encore sauvegardée). */
  onChange(id: string, patch: { x: number; y: number; l: number }): void;
  /** Geste terminé : sauvegarder. */
  onFin(id: string): void;
  onAction(id: string, action: ActionBloc): void;
}

type Poignee = 'corps' | 'sw' | 'se';

/**
 * Cadre d'édition du bloc de texte sélectionné : glisser le corps = déplacer, glisser un coin du bas = changer la largeur (le texte se remet en page).
 * Pour un exercice : Indice, Solution (qui compte « réussi avec aide »), + de place. Le doigt et le stylet agissent tous deux sur le cadre.
 */
export function createBlocCadre(parent: HTMLElement, vp: Viewport, hooks: CadreBlocHooks) {
  const el = Object.assign(document.createElement('div'), { id: 'bloc-cadre' });
  const barre = Object.assign(document.createElement('div'), { className: 'actions' });
  el.append(barre);
  for (const h of ['sw', 'se'] as const) {
    const coin = Object.assign(document.createElement('span'), { className: `coin ${h}` });
    coin.dataset.h = h;
    el.append(coin);
  }
  el.hidden = true;
  parent.appendChild(el);

  // La feuille annule touchstart/click (anti double-tap Safari) : ils ne doivent pas remonter jusqu'à elle, sinon nos boutons ne répondent pas.
  for (const ev of ['touchstart', 'touchmove', 'click', 'dblclick']) el.addEventListener(ev, (e) => e.stopPropagation());

  let bloc: Bloc | null = null;
  let geste: { h: Poignee; pointeur: number; x: number; y: number; depart: { x: number; y: number; l: number } } | null = null;

  const bouton = (texte: string, action: ActionBloc, cls = '') => {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: texte, className: cls });
    b.addEventListener('click', () => bloc && hooks.onAction(bloc.id, action));
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    return b;
  };

  function actions() {
    if (!bloc) return;
    barre.replaceChildren(
      ...(bloc.type === 'exercice' ? [bouton('Indice', 'indice'), bouton('Solution', 'solution')] : [bouton('Supprimer', 'supprimer', 'danger')]),
      bouton('+ de place', 'place'),
      bouton('OK', 'fermer', 'principal'),
    );
  }

  function placer() {
    if (!bloc) {
      el.hidden = true;
      return;
    }
    const s = vp.scale;
    el.hidden = false;
    el.style.width = `${bloc.l * s}px`;
    el.style.height = `${bloc.hTexte * s}px`;
    el.style.transform = `translate(${vp.tx + bloc.x * s}px, ${vp.ty + bloc.y * s}px)`;
    el.classList.toggle('actions-bas', vp.ty + bloc.y * s < 64);
  }

  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!bloc || geste) return;
    const cible = (e.target as HTMLElement).dataset.h as Poignee | undefined;
    geste = { h: cible ?? 'corps', pointeur: e.pointerId, x: e.clientX, y: e.clientY, depart: { x: bloc.x, y: bloc.y, l: bloc.l } };
    el.setPointerCapture(e.pointerId);
  });

  el.addEventListener('pointermove', (e) => {
    e.stopPropagation();
    if (!geste || !bloc || e.pointerId !== geste.pointeur) return;
    e.preventDefault();
    const dx = (e.clientX - geste.x) / vp.scale;
    const dy = (e.clientY - geste.y) / vp.scale;
    const d = geste.depart;
    let { x, y, l } = d;
    if (geste.h === 'corps') {
      x = Math.min(LARGEUR_FEUILLE - l, Math.max(0, d.x + dx));
      y = Math.max(0, d.y + dy);
    } else if (geste.h === 'se') {
      l = Math.min(LARGEUR_FEUILLE - d.x, Math.max(LARGEUR_BLOC_MIN, d.l + dx));
    } else {
      l = Math.min(d.x + d.l, Math.max(LARGEUR_BLOC_MIN, d.l - dx));
      x = d.x + d.l - l; // le bord droit reste fixe
    }
    hooks.onChange(bloc.id, { x, y, l });
  });

  const fin = (e: PointerEvent) => {
    e.stopPropagation();
    if (!geste || e.pointerId !== geste.pointeur) return;
    geste = null;
    if (bloc) hooks.onFin(bloc.id);
  };
  el.addEventListener('pointerup', fin);
  el.addEventListener('pointercancel', fin);

  return {
    get idSelectionne() {
      return bloc?.id ?? null;
    },
    /** Sélectionne le bloc (null = désélection) ou met à jour le cadre après un changement. */
    afficher(b: Bloc | null) {
      const change = b?.id !== bloc?.id;
      bloc = b;
      if (change) actions();
      placer();
    },
    suivre: placer,
  };
}
