import { listePages, pageCourante, type InfoPage } from '../pages';

export interface PagesHooks {
  onNouvelle(): void;
  onOuvrir(id: string): void;
  onRenommer(id: string, nom: string): void;
  onSupprimer(id: string): void;
}

const quand = (t: number) => new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Liste des pages du cahier : ouvrir, créer, renommer, supprimer (avec confirmation). */
export function createPages(hooks: PagesHooks) {
  const el = Object.assign(document.createElement('div'), { id: 'pages-panneau' });
  document.body.appendChild(el);
  let confirmation: string | null = null; // page dont la suppression attend un second appui
  let renommage: string | null = null;

  function fermer() {
    el.classList.remove('ouvert');
    confirmation = null;
    renommage = null;
  }

  function ligne(p: InfoPage): HTMLElement {
    const li = Object.assign(document.createElement('div'), { className: `page-ligne${p.id === pageCourante().id ? ' courante' : ''}` });
    if (renommage === p.id) {
      const champ = Object.assign(document.createElement('input'), { type: 'text', value: p.nom, maxLength: 60 });
      const ok = () => {
        hooks.onRenommer(p.id, champ.value);
        renommage = null;
        rendre();
      };
      champ.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') ok();
      });
      const valider = Object.assign(document.createElement('button'), { type: 'button', textContent: 'OK' });
      valider.addEventListener('click', ok);
      li.append(champ, valider);
      queueMicrotask(() => champ.select());
      return li;
    }
    const ouvrir = Object.assign(document.createElement('button'), { type: 'button', className: 'page-nom' });
    ouvrir.append(Object.assign(document.createElement('span'), { textContent: p.nom }), Object.assign(document.createElement('small'), { textContent: quand(p.modifie) }));
    ouvrir.addEventListener('click', () => {
      fermer();
      if (p.id !== pageCourante().id) hooks.onOuvrir(p.id);
    });
    const renommer = Object.assign(document.createElement('button'), { type: 'button', textContent: '✎', ariaLabel: 'Renommer' });
    renommer.addEventListener('click', () => {
      renommage = p.id;
      confirmation = null;
      rendre();
    });
    li.append(ouvrir, renommer);
    if (listePages().length > 1) {
      const attend = confirmation === p.id;
      const suppr = Object.assign(document.createElement('button'), { type: 'button', textContent: attend ? 'Supprimer ?' : '🗑', ariaLabel: 'Supprimer', className: attend ? 'danger' : '' });
      suppr.addEventListener('click', () => {
        if (!attend) {
          confirmation = p.id;
          rendre();
          return;
        }
        confirmation = null;
        hooks.onSupprimer(p.id);
        rendre();
      });
      li.append(suppr);
    }
    return li;
  }

  function rendre() {
    const entete = Object.assign(document.createElement('div'), { className: 'entete' });
    const fermerBtn = Object.assign(document.createElement('button'), { type: 'button', textContent: '×', ariaLabel: 'Fermer' });
    fermerBtn.addEventListener('click', fermer);
    entete.append(Object.assign(document.createElement('span'), { className: 'titre', textContent: 'Pages' }), fermerBtn);
    const nouvelle = Object.assign(document.createElement('button'), { type: 'button', className: 'nouvelle', textContent: '+ Nouvelle page' });
    nouvelle.addEventListener('click', () => {
      fermer();
      hooks.onNouvelle();
    });
    const liste = Object.assign(document.createElement('div'), { className: 'page-liste' });
    liste.append(...[...listePages()].sort((a, b) => b.modifie - a.modifie).map(ligne));
    el.replaceChildren(entete, nouvelle, liste);
  }

  // Un appui en dehors referme la liste.
  document.addEventListener('pointerdown', (e) => {
    if (el.classList.contains('ouvert') && !el.contains(e.target as Node) && !(e.target as Element).closest?.('[data-pages-btn]')) fermer();
  });

  return {
    basculer() {
      if (el.classList.contains('ouvert')) return fermer();
      rendre();
      el.classList.add('ouvert');
    },
    fermer,
  };
}
