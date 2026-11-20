import {
  ajouterMessage,
  appliquerReponse,
  creerCours,
  definirStatut,
  listeCours,
  progression,
  supprimerCours,
  trouverCours,
  type Cours,
  type Exercice,
  type SectionCours,
} from '../cours';
import { ErreurReco, elaborerCours } from '../reco';
import { noteTexte } from './latex';

export interface CoursHooks {
  /** Photos de la page courante (data URL), à joindre à la demande si l'élève le souhaite. */
  photos(): string[];
  /** Le panneau s'ouvre : l'app ferme ses autres panneaux. */
  onOuvrir(): void;
  /** Cours généré : l'app crée sa page et y écrit le cours à la main. */
  onCoursCree(c: Cours): void;
  /** Ouvre la page du cours (la crée si elle n'existe pas encore). */
  onOuvrirPage(c: Cours): void;
  /** Exercices (et sections) ajoutés par une demande écrite : l'app les écrit en bas de la page du cours. */
  onExercicesAjoutes(c: Cours, nouveaux: Exercice[], sections?: SectionCours[]): void;
}

const NIVEAU_KEY = 'tutorat.cours.niveau';
const NIVEAU_DEFAUT = "1re année d'école d'ingénieur";
const LONGUEURS = [['court', 'Court'], ['moyen', 'Moyen'], ['long', 'Développé']] as const;
const NB_EXERCICES = [3, 5, 8] as const;
const STATUTS: Record<Exercice['statut'], string> = {
  a_faire: 'à faire',
  en_cours: 'en cours',
  reussi: 'réussi',
  avec_aide: 'réussi avec aide',
  erreurs: 'erreurs',
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...enfants: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...enfants);
  return e;
};

/** Texte de cours : paragraphes séparés par une ligne vide, formules $…$ rendues par KaTeX. */
function paragraphes(texte: string): HTMLElement[] {
  return texte
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => el('p', { className: 'para' }, noteTexte(p)));
}

/** Panneau « Cours » : liste des cours, création d'un cours, lecture (texte + exercices) et demandes écrites au tuteur. */
export function createCours(hooks: CoursHooks) {
  const panneau = el('div', { id: 'cours-panneau' });
  document.body.appendChild(panneau);

  type Vue = { v: 'liste' } | { v: 'nouveau' } | { v: 'cours'; id: string };
  let vue: Vue = { v: 'liste' };
  let occupe = false;
  let confirmation: string | null = null; // cours dont la suppression attend un second appui
  /** Exercices dont l'indice / la solution sont dépliés (le temps de la session). */
  const indices = new Set<string>();
  const solutions = new Set<string>();
  let brouillon = { notion: '', precisions: '', longueur: 'moyen' as (typeof LONGUEURS)[number][0], nb: 5 as number, joindre: false };
  let defilerVers: string | null = null;

  function niveauMemorise(): string {
    try {
      return localStorage.getItem(NIVEAU_KEY) || NIVEAU_DEFAUT;
    } catch {
      return NIVEAU_DEFAUT;
    }
  }

  function aller(v: Vue) {
    vue = v;
    confirmation = null;
    rendre();
  }

  function fermer() {
    panneau.classList.remove('ouvert');
  }

  // --- Liste ------------------------------------------------------------------------------------------------------
  function vueListe(): HTMLElement {
    const cours = listeCours();
    const nouveau = el('button', { type: 'button', className: 'principal gros', textContent: '+ Nouveau cours' });
    nouveau.addEventListener('click', () => aller({ v: 'nouveau' }));
    const liste = el('div', { className: 'cours-liste' });
    if (!cours.length) liste.append(el('p', { className: 'dim', textContent: 'Aucun cours pour le moment. Choisis une notion et le tuteur écrit le cours et les exercices.' }));
    for (const c of cours) {
      const { faits, total } = progression(c);
      const ouvrir = el('button', { type: 'button', className: 'cours-carte' });
      ouvrir.append(
        el('strong', { textContent: c.titre }),
        el('small', { textContent: `${total ? `${faits}/${total} exercices faits` : 'aucun exercice'} · ${new Date(c.modifie).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}` }),
      );
      ouvrir.addEventListener('click', () => aller({ v: 'cours', id: c.id }));
      const attend = confirmation === c.id;
      const suppr = el('button', { type: 'button', textContent: attend ? 'Supprimer ?' : '🗑', ariaLabel: 'Supprimer le cours', className: attend ? 'danger' : 'discret' });
      suppr.addEventListener('click', () => {
        if (!attend) {
          confirmation = c.id;
          rendre();
          return;
        }
        supprimerCours(c.id);
        confirmation = null;
        rendre();
      });
      liste.append(el('div', { className: 'cours-ligne' }, ouvrir, suppr));
    }
    return el('div', { className: 'cours-corps' }, nouveau, liste);
  }

  // --- Création ---------------------------------------------------------------------------------------------------
  function vueNouveau(): HTMLElement {
    const notion = el('input', { type: 'text', placeholder: 'ex. : transformée de Fourier, intégrales doubles…', maxLength: 300, value: brouillon.notion });
    notion.addEventListener('input', () => (brouillon.notion = notion.value));
    const niveau = el('input', { type: 'text', maxLength: 120, value: niveauMemorise() });
    const precisions = el('textarea', { placeholder: 'Précisions (facultatif) : ce que tu sais déjà, ce qui te bloque, le chapitre du polycopié…', rows: 3, maxLength: 1500, value: brouillon.precisions });
    precisions.addEventListener('input', () => (brouillon.precisions = precisions.value));

    const choix = <T extends string | number>(titre: string, options: readonly (readonly [T, string])[], courant: T, change: (v: T) => void) => {
      const boutons = options.map(([v, nom]) => {
        const b = el('button', { type: 'button', textContent: nom, className: v === courant ? 'actif' : '' });
        b.addEventListener('click', () => {
          change(v);
          boutons.forEach((x, i) => x.classList.toggle('actif', options[i][0] === v));
        });
        return b;
      });
      return el('div', { className: 'champ' }, el('label', { textContent: titre }), el('div', { className: 'choix-ligne' }, ...boutons));
    };

    const photos = hooks.photos();
    const joindre = el('input', { type: 'checkbox', checked: brouillon.joindre });
    joindre.addEventListener('change', () => (brouillon.joindre = joindre.checked));

    const erreur = el('p', { className: 'echec' });
    erreur.hidden = true;
    const creer = el('button', { type: 'button', className: 'principal gros', textContent: 'Créer le cours' });
    creer.addEventListener('click', async () => {
      const texte = brouillon.notion.trim();
      const joints = brouillon.joindre ? photos : [];
      if (!texte && !joints.length) {
        erreur.textContent = 'Indique une notion (ou joins une photo).';
        erreur.hidden = false;
        return;
      }
      const niv = niveau.value.trim() || NIVEAU_DEFAUT;
      try {
        localStorage.setItem(NIVEAU_KEY, niv);
      } catch {
        /* ignoré */
      }
      occupe = true;
      erreur.hidden = true;
      creer.disabled = true;
      creer.textContent = 'Le tuteur écrit ton cours… (une trentaine de secondes)';
      try {
        const rep = await elaborerCours({
          mode: 'creer', notion: texte, niveau: niv, longueur: brouillon.longueur, nb_exercices: brouillon.nb,
          precisions: brouillon.precisions.trim() || undefined, photos: joints.length ? joints : undefined,
        });
        const c = creerCours(texte || rep.titre, niv, rep);
        if (rep.message) ajouterMessage(c.id, 'tuteur', rep.message);
        brouillon = { ...brouillon, notion: '', precisions: '', joindre: false };
        occupe = false;
        vue = { v: 'cours', id: c.id }; // au retour dans le panneau, on retrouve ce cours
        hooks.onCoursCree(c);
      } catch (e) {
        occupe = false;
        creer.disabled = false;
        creer.textContent = 'Créer le cours';
        erreur.textContent = `Impossible de créer le cours : ${e instanceof ErreurReco ? e.message : e}`;
        erreur.hidden = false;
      }
    });

    return el(
      'div', { className: 'cours-corps formulaire-cours' },
      el('div', { className: 'champ' }, el('label', { textContent: 'Notion à apprendre' }), notion),
      el('div', { className: 'champ' }, el('label', { textContent: 'Niveau' }), niveau),
      choix('Longueur du cours', LONGUEURS, brouillon.longueur, (v) => (brouillon.longueur = v)),
      choix('Nombre d’exercices', NB_EXERCICES.map((n) => [n, String(n)] as const), brouillon.nb, (v) => (brouillon.nb = v)),
      el('div', { className: 'champ' }, el('label', { textContent: 'Précisions' }), precisions),
      ...(photos.length ? [el('label', { className: 'case' }, joindre, ` Joindre les ${photos.length} photo${photos.length > 1 ? 's' : ''} de la page courante (énoncé, extrait de cours…)`)] : []),
      erreur,
      creer,
    );
  }

  // --- Lecture d'un cours -------------------------------------------------------------------------------------------
  function carteExercice(c: Cours, e: Exercice, n: number): HTMLElement {
    const carte = el('div', { className: `exercice statut-${e.statut}` });
    carte.dataset.id = e.id;
    carte.append(
      el('div', { className: 'ex-tete' },
        el('strong', { textContent: `Exercice ${n}` }),
        el('span', { className: 'badge-diff', textContent: '★'.repeat(e.difficulte) + '☆'.repeat(3 - e.difficulte), title: 'Difficulté' }),
        el('span', { className: `badge-statut ${e.statut}`, textContent: STATUTS[e.statut] })),
      el('div', { className: 'ex-enonce' }, ...paragraphes(e.enonce)),
    );
    const bloc = el('div', { className: 'ex-reponses' });
    if (indices.has(e.id)) bloc.append(el('div', { className: 'ex-indice' }, el('b', { textContent: 'Indice. ' }), noteTexte(e.indice || 'Pas d’indice pour cet exercice.')));
    if (solutions.has(e.id)) {
      bloc.append(el('div', { className: 'ex-solution' }, el('b', { textContent: 'Solution' }), ...paragraphes(e.solution)));
      if (e.statut === 'avec_aide') bloc.append(el('p', { className: 'dim', textContent: 'Solution consultée : exercice compté « réussi avec aide ».' }));
    }
    const actions = el('div', { className: 'ex-actions' });
    if (!indices.has(e.id)) {
      const b = el('button', { type: 'button', textContent: 'Indice' });
      b.addEventListener('click', () => {
        indices.add(e.id);
        rendre();
      });
      actions.append(b);
    }
    if (!solutions.has(e.id)) {
      const b = el('button', { type: 'button', textContent: 'Voir la solution' });
      b.addEventListener('click', () => {
        solutions.add(e.id);
        if (e.statut === 'a_faire' || e.statut === 'en_cours') definirStatut(c.id, e.id, 'avec_aide');
        rendre();
      });
      actions.append(b);
    }
    carte.append(bloc, actions);
    return carte;
  }

  function vueCours(c: Cours): HTMLElement {
    const corps = el('div', { className: 'cours-corps' });
    const page = el('button', { type: 'button', className: 'principal gros', textContent: c.pageId ? 'Ouvrir la page du cours' : 'Écrire le cours sur une page' });
    page.addEventListener('click', () => hooks.onOuvrirPage(c));
    corps.append(page, el('p', { className: 'dim', textContent: 'Le cours est écrit à la main sur sa page, chaque exercice suivi d\u2019un espace pour répondre. Ici : indices, solutions et suivi.' }));
    const { faits, total } = progression(c);
    corps.append(el('h3', { className: 'exos', textContent: `Exercices${total ? ` · ${faits}/${total}` : ''}` }));
    if (!c.exercices.length) corps.append(el('p', { className: 'dim', textContent: 'Aucun exercice : demande-en ci-dessous.' }));
    c.exercices.forEach((e, i) => corps.append(carteExercice(c, e, i + 1)));

    // Demandes écrites : plus d'exercices, autre explication, question…
    const fil = el('div', { className: 'cours-fil' });
    for (const m of c.messages.slice(-8)) fil.append(el('div', { className: `bulle-msg ${m.role}` }, m.role === 'tuteur' ? noteTexte(m.texte) : m.texte));
    const champ = el('input', { type: 'text', placeholder: 'Ta demande : plus d’exercices sur… / explique autrement / plus difficile…', maxLength: 1500, enterKeyHint: 'send' });
    const envoyer = el('button', { type: 'button', className: 'principal', textContent: 'Envoyer' });
    const attente = el('p', { className: 'dim' });
    attente.hidden = true;
    const erreur = el('p', { className: 'echec' });
    erreur.hidden = true;
    const soumettre = async () => {
      const demande = champ.value.trim();
      if (!demande || occupe) return;
      const historique = c.messages.slice(-8).map(({ role, texte }) => ({ role, texte }));
      occupe = true;
      champ.disabled = envoyer.disabled = true;
      erreur.hidden = true;
      attente.hidden = false;
      attente.textContent = 'Le tuteur travaille… (20 à 40 secondes)';
      try {
        const rep = await elaborerCours({
          mode: 'modifier', niveau: c.niveau, demande, historique,
          cours: { titre: c.titre, sections: c.sections, exercices: c.exercices.map((e) => ({ difficulte: e.difficulte, enonce: e.enonce })) },
        });
        ajouterMessage(c.id, 'eleve', demande);
        const nouveaux = appliquerReponse(c.id, rep);
        ajouterMessage(c.id, 'tuteur', rep.message || (nouveaux.length ? `${nouveaux.length} exercice${nouveaux.length > 1 ? 's' : ''} ajouté${nouveaux.length > 1 ? 's' : ''}.` : 'Fait.'));
        defilerVers = nouveaux[0]?.id ?? null;
        occupe = false;
        if (nouveaux.length || rep.sections.length) hooks.onExercicesAjoutes(trouverCours(c.id)!, nouveaux, rep.sections.length ? rep.sections : undefined);
        else rendre(); // simple question : la réponse s'affiche dans le fil
      } catch (e) {
        occupe = false;
        champ.disabled = envoyer.disabled = false;
        attente.hidden = true;
        erreur.textContent = `Impossible d’envoyer : ${e instanceof ErreurReco ? e.message : e}`;
        erreur.hidden = false;
      }
    };
    envoyer.addEventListener('click', () => void soumettre());
    champ.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void soumettre();
    });
    corps.append(fil, el('div', { className: 'cours-composer' }, champ, envoyer), attente, erreur);
    return corps;
  }

  // --- Cadre ------------------------------------------------------------------------------------------------------
  function rendre() {
    const entete = el('div', { className: 'entete' });
    const fermerBtn = el('button', { type: 'button', textContent: '×', ariaLabel: 'Fermer' });
    fermerBtn.addEventListener('click', fermer);
    let corps: HTMLElement;
    let titre = 'Cours';
    let retour = false;
    if (vue.v === 'cours') {
      const c = trouverCours(vue.id);
      if (!c) return aller({ v: 'liste' });
      titre = c.titre;
      retour = true;
      corps = vueCours(c);
    } else if (vue.v === 'nouveau') {
      titre = 'Nouveau cours';
      retour = true;
      corps = vueNouveau();
    } else {
      corps = vueListe();
    }
    if (retour) {
      const b = el('button', { type: 'button', textContent: '‹ Mes cours', className: 'retour-cours' });
      b.addEventListener('click', () => !occupe && aller({ v: 'liste' }));
      entete.append(b);
    }
    entete.append(el('span', { className: 'titre', textContent: titre }), fermerBtn);
    const ancien = panneau.querySelector('.cours-corps')?.scrollTop ?? 0;
    panneau.replaceChildren(entete, corps);
    if (defilerVers) {
      panneau.querySelector(`[data-id="${defilerVers}"]`)?.scrollIntoView({ block: 'start' });
      defilerVers = null;
    } else {
      corps.scrollTop = ancien;
    }
  }

  return {
    /** Depuis la page : ouvre le panneau sur cet exercice, avec son indice ou sa solution (la solution compte « réussi avec aide »). */
    ouvrirExercice(coursId: string, exerciceId: string, quoi: 'indice' | 'solution') {
      const c = trouverCours(coursId);
      const e = c?.exercices.find((x) => x.id === exerciceId);
      if (!c || !e) return;
      hooks.onOuvrir();
      (quoi === 'indice' ? indices : solutions).add(e.id);
      if (quoi === 'solution' && (e.statut === 'a_faire' || e.statut === 'en_cours')) definirStatut(c.id, e.id, 'avec_aide');
      vue = { v: 'cours', id: c.id };
      defilerVers = e.id;
      rendre();
      panneau.classList.add('ouvert');
    },
    basculer() {
      if (panneau.classList.contains('ouvert')) return fermer();
      hooks.onOuvrir();
      rendre();
      panneau.classList.add('ouvert');
    },
    fermer,
  };
}
