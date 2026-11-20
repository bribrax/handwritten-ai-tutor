import katex from 'katex';
import { etat, type ItemAnnotation } from '../annotations';
import { ajouterMessage, derniers, effacerConversation, messagesConversation } from '../conversation';
import { ENONCE_MAX } from '../model';
import type { Annotation, GroupeLu, Resultat } from '../reco';
import { formule, noteTexte } from './latex';
import { PHOTOS_MAX, ajouterPhoto, fichierVersPhoto, listePhotos, recadrerPhoto, retirerPhoto, type Photo } from '../photos';
import { ouvrirVisionneuse } from './photo';

export interface ResultatsHooks {
  /** Groupe touché (null = sélection retirée) : l'app l'entoure sur la feuille. */
  onSelect(g: GroupeLu | null): void;
  onClose(): void;
  /** Texte de l'énoncé modifié (frappe en cours). */
  onEnonce(texte: string): void;
  /** L'élève répond sur une ligne (précision, réponse à une lecture douteuse) : renvoie la réponse du tuteur ; lève une erreur lisible si ça échoue. */
  onRepondre(item: ItemAnnotation, texte: string): Promise<string>;
  /** Message libre au tuteur, éventuellement à propos d'une ligne (et avec la zone montrée au lasso, s'il y en a une) : renvoie sa réponse. */
  onMessage(texte: string, cible: { empreinte: string; id: string } | null, historique: { role: 'eleve' | 'tuteur'; texte: string }[]): Promise<string>;
  /** « Montrer une zone » : arme le lasso sur la feuille. */
  onMontrerZone(): void;
  /** Abandon de la zone montrée. */
  onAnnulerZone(): void;
  /** Pose la photo sur la feuille (ou l'en retire si elle y est déjà). */
  onPlacerPhoto(photo: Photo): void;
  /** Les photos ont changé (recadrage, suppression) : redessiner celles de la feuille. */
  onPhotos(): void;
}

/** Confusions fréquentes d'écriture manuscrite : un appui ajoute le symbole à la précision. */
const CONFUSIONS: string[][] = [['x', '×', 'n'], ['2', 'z'], ['1', 'ℓ', 'l'], ['0', 'o'], ['u', 'v'], ['g', 'γ'], ['5', 's'], ['t', 'τ'], ['−', '·', '=']];

const LIBELLES: Record<Annotation['type'], string> = {
  ok: 'ok',
  erreur: 'erreur',
  indice: 'indice',
  lecture_douteuse: 'lecture douteuse',
  remarque_generale: 'remarque',
};

/** Panneau en bas de l'écran : annotations de correction, puis une ligne par groupe lu (formule rendue + LaTeX). */
export function createResultats(hooks: ResultatsHooks) {
  const panneau = Object.assign(document.createElement('div'), { id: 'resultats' });
  const entete = Object.assign(document.createElement('div'), { className: 'entete' });
  const titre = Object.assign(document.createElement('span'), { className: 'titre' });
  const fermer = Object.assign(document.createElement('button'), { textContent: '×', ariaLabel: 'Fermer' });
  fermer.addEventListener('click', () => hooks.onClose());
  entete.append(titre, fermer);
  const liste = Object.assign(document.createElement('div'), { className: 'liste' });
  // Énoncé facultatif : texte libre, retenu avec la feuille et envoyé à chaque correction.
  const enonceBloc = Object.assign(document.createElement('details'), { className: 'enonce' });
  const enonceTitre = Object.assign(document.createElement('summary'), { textContent: 'Énoncé (facultatif)' });
  const enonceChamp = Object.assign(document.createElement('textarea'), {
    placeholder: "Recopiez l'énoncé : il aide à juger les étapes. Puis touchez Corriger.",
    maxLength: ENONCE_MAX,
    rows: 3,
  });
  enonceChamp.addEventListener('input', () => {
    majResume();
    hooks.onEnonce(enonceChamp.value);
  });
  function majResume() {
    const t = enonceChamp.value.trim().replace(/\s+/g, ' ');
    const n = listePhotos().length;
    const photos = n ? ` · ${n} photo${n > 1 ? 's' : ''}` : '';
    enonceTitre.textContent = (t ? `Énoncé : ${t.length > 60 ? `${t.slice(0, 60)}…` : t}` : n ? 'Énoncé' : 'Énoncé (facultatif)') + photos;
  }
  // Photos de l'énoncé : miniatures (toucher = agrandir, déplacer, recadrer, supprimer) et bouton d'ajout (appareil photo ou photothèque).
  const photosBloc = Object.assign(document.createElement('div'), { className: 'photos' });
  const miniatures = Object.assign(document.createElement('div'), { className: 'miniatures' });
  const ajouterBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'ajout-photo', textContent: '+ Ajouter une photo' });
  const photoMsg = Object.assign(document.createElement('span'), { className: 'photo-msg' });
  const photoChamp = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', hidden: true });
  ajouterBtn.addEventListener('click', () => photoChamp.click());
  photoChamp.addEventListener('change', async () => {
    const f = photoChamp.files?.[0];
    photoChamp.value = ''; // permet de rechoisir le même fichier
    if (!f) return;
    photoMsg.textContent = 'Préparation de la photo…';
    try {
      const p = ajouterPhoto(await fichierVersPhoto(f));
      photoMsg.textContent = p ? '' : `Maximum ${PHOTOS_MAX} photos par page.`;
      majPhotos();
      if (p) ouvrirPhoto(p.id); // propose tout de suite de recadrer
    } catch {
      photoMsg.textContent = "Cette image n'a pas pu être lue.";
    }
  });
  function ouvrirPhoto(id: string) {
    const photo = listePhotos().find((x) => x.id === id);
    if (!photo) return;
    ouvrirVisionneuse(photo, {
      async onRecadrer(p, x, y, w, h) {
        const maj = await recadrerPhoto(p.id, x, y, w, h);
        majPhotos();
        hooks.onPhotos();
        return maj;
      },
      onSupprimer(p) {
        retirerPhoto(p.id);
        majPhotos();
        hooks.onPhotos();
      },
      onPlacer: (p) => hooks.onPlacerPhoto(p),
    });
  }
  function majPhotos() {
    miniatures.replaceChildren(
      ...listePhotos().map((p) => {
        const b = Object.assign(document.createElement('button'), { type: 'button', className: 'miniature', ariaLabel: 'Ouvrir la photo' });
        b.append(Object.assign(document.createElement('img'), { src: p.src, alt: '', draggable: false }));
        b.addEventListener('click', () => ouvrirPhoto(p.id));
        return b;
      }),
    );
    ajouterBtn.disabled = listePhotos().length >= PHOTOS_MAX;
    majResume();
  }
  photosBloc.append(miniatures, ajouterBtn, photoMsg, photoChamp);
  enonceBloc.append(enonceTitre, enonceChamp, photosBloc);
  const corps = Object.assign(document.createElement('div'), { className: 'corps' });
  const fil = Object.assign(document.createElement('div'), { className: 'fil' });
  corps.append(liste, fil);
  const composer = Object.assign(document.createElement('div'), { className: 'composer' });
  const puces = Object.assign(document.createElement('div'), { className: 'puces' });
  const saisie = Object.assign(document.createElement('div'), { className: 'saisie' });
  const boutonZone = Object.assign(document.createElement('button'), { type: 'button', className: 'zone', textContent: 'Montrer une zone', title: 'Entourer au lasso un dessin ou une partie de la feuille' });
  const champMsg = Object.assign(document.createElement('input'), { type: 'text', placeholder: 'Écris un message au tuteur…', maxLength: 1500, enterKeyHint: 'send' });
  const boutonMsg = Object.assign(document.createElement('button'), { type: 'button', className: 'envoyer-msg', textContent: 'Envoyer' });
  saisie.append(boutonZone, champMsg, boutonMsg);
  composer.append(puces, saisie);
  panneau.append(entete, enonceBloc, corps, composer);
  document.body.appendChild(panneau);

  let actif: HTMLElement | null = null;

  // --- Discussion avec le tuteur --------------------------------------------------------------------------------------
  let cible: { empreinte: string; id: string } | null = null; // ligne dont on parle (annotation touchée, ligne choisie dans la liste)
  let zoneN = 0; // nombre de traits entourés au lasso
  let zoneArmee = false; // le lasso attend la zone
  let occupe = false;

  function puce(texte: string, retirer: () => void): HTMLElement {
    const p = Object.assign(document.createElement('span'), { className: 'puce' });
    const x = Object.assign(document.createElement('button'), { type: 'button', textContent: '×', ariaLabel: 'Retirer' });
    x.addEventListener('click', retirer);
    p.append(texte, x);
    return p;
  }

  function majPuces() {
    puces.replaceChildren();
    if (cible) puces.append(puce(`À propos de ${cible.id}`, () => { cible = null; majPuces(); }));
    if (zoneArmee) puces.append(puce('Entoure la zone sur la feuille…', annulerZone));
    else if (zoneN > 0) puces.append(puce(`Zone montrée : ${zoneN} trait${zoneN > 1 ? 's' : ''}`, annulerZone));
  }

  function annulerZone() {
    zoneArmee = false;
    zoneN = 0;
    panneau.classList.remove('discret');
    hooks.onAnnulerZone();
    majPuces();
  }

  boutonZone.addEventListener('click', () => {
    zoneArmee = true;
    zoneN = 0;
    panneau.classList.add('discret'); // le panneau se réduit pour laisser voir la feuille
    hooks.onMontrerZone();
    majPuces();
  });

  /** Messages de la discussion (de cette feuille), plus un message d'attente ou d'échec éventuel. */
  function rendreFil(etat?: { classe: 'attente' | 'echec'; texte: string }) {
    const msgs = messagesConversation();
    const noeuds: Node[] = [];
    if (msgs.length || etat) {
      const tete = Object.assign(document.createElement('div'), { className: 'fil-tete' });
      tete.append(Object.assign(document.createElement('span'), { textContent: 'Discussion' }));
      if (msgs.length) {
        const eff = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Effacer' });
        eff.addEventListener('click', () => {
          effacerConversation();
          rendreFil();
        });
        tete.append(eff);
      }
      noeuds.push(tete);
    }
    for (const m of msgs) {
      const b = Object.assign(document.createElement('div'), { className: `bulle-msg ${m.role}` });
      if (m.ligne) b.append(Object.assign(document.createElement('span'), { className: 'ligne-msg', textContent: m.ligne }));
      b.append(m.role === 'tuteur' ? noteTexte(m.texte) : document.createTextNode(m.texte));
      noeuds.push(b);
    }
    if (etat) noeuds.push(Object.assign(document.createElement('div'), { className: `bulle-msg tuteur ${etat.classe}`, textContent: etat.texte }));
    fil.replaceChildren(...noeuds);
  }

  async function envoyerMessage() {
    const texte = champMsg.value.trim();
    if (!texte || occupe) return;
    occupe = true;
    composer.classList.add('occupe');
    const historique = derniers(8); // avant ce message
    const ligne = cible;
    ajouterMessage('eleve', texte, ligne?.id);
    champMsg.value = '';
    rendreFil({ classe: 'attente', texte: 'Le tuteur réfléchit…' });
    corps.scrollTop = corps.scrollHeight;
    try {
      const reponse = await hooks.onMessage(texte, ligne, historique);
      ajouterMessage('tuteur', reponse, ligne?.id);
      rendreFil();
    } catch (e) {
      rendreFil({ classe: 'echec', texte: `Impossible d'envoyer : ${e instanceof Error ? e.message : e}` });
    } finally {
      occupe = false;
      composer.classList.remove('occupe');
      zoneArmee = false;
      zoneN = 0;
      panneau.classList.remove('discret');
      majPuces();
      corps.scrollTop = corps.scrollHeight;
    }
  }
  boutonMsg.addEventListener('click', () => void envoyerMessage());
  champMsg.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void envoyerMessage();
  });

  /** Ouvre le panneau, avec le fil de discussion à jour. */
  function ouvrir() {
    rendreFil();
    panneau.classList.add('ouvert');
  }

  /** Ligne cliquable : entoure le groupe sur la feuille (ou retire le cadre). */
  function selectionnable(el: HTMLElement, g: GroupeLu | undefined) {
    if (!g) return;
    el.addEventListener('click', () => {
      const deja = actif === el;
      actif?.classList.remove('actif');
      actif = deja ? null : el;
      actif?.classList.add('actif');
      if (!deja && g.empreinte) {
        cible = { empreinte: g.empreinte, id: g.id };
        majPuces();
      }
      hooks.onSelect(deja ? null : g);
    });
  }

  function ligneLecture(g: GroupeLu): HTMLElement {
    const el = Object.assign(document.createElement('button'), { className: 'ligne' });
    const maths = Object.assign(document.createElement('div'), { className: 'maths' });
    if (g.statut === 'lecture_echouee') {
      // La génération a bouclé ou dépassé son plafond : rien de fiable à montrer, et Claude l'a reçue comme « non lue ».
      el.classList.add('nonlue');
      maths.textContent = 'Ligne non lue';
      maths.classList.add('erreur');
    } else {
      try {
        katex.render(g.latex, maths, { throwOnError: true, displayMode: false });
      } catch {
        maths.textContent = '(formule illisible)';
        maths.classList.add('erreur');
      }
    }
    const source = Object.assign(document.createElement('code'), { textContent: g.statut === 'lecture_echouee' ? `${g.id} · lecture échouée` : `${g.id} · ${g.latex}` });
    el.append(maths, source);
    selectionnable(el, g);
    return el;
  }

  function ligneAnnotation(a: Annotation, groupes: Map<string, GroupeLu>): HTMLElement {
    const el = Object.assign(document.createElement('button'), { className: `ligne annotation ${a.type}` });
    const tete = Object.assign(document.createElement('div'), { className: 'tete' });
    tete.append(Object.assign(document.createElement('span'), { className: 'badge', textContent: LIBELLES[a.type] }));
    if (a.groupe) tete.append(Object.assign(document.createElement('span'), { className: 'gid', textContent: a.groupe }));
    el.append(tete);
    if (a.extrait) {
      const c = Object.assign(document.createElement('div'), { className: 'corps' });
      c.append(formule(a.extrait));
      el.append(c);
    }
    if (a.lu && a.propose) {
      const c = Object.assign(document.createElement('div'), { className: 'corps' });
      c.append('lu ', formule(a.lu), ' → ', formule(a.propose), ' ?');
      el.append(c);
    }
    if (a.note) {
      const c = Object.assign(document.createElement('div'), { className: 'corps' });
      c.append(noteTexte(a.note));
      el.append(c);
    }
    if (a.type === 'erreur' && a.verifiee !== undefined) {
      el.append(Object.assign(document.createElement('div'), { className: 'verif', textContent: a.verifiee ? 'relue sur l’image' : 'non relue sur l’image' }));
    }
    selectionnable(el, a.groupe ? groupes.get(a.groupe) : undefined);
    return el;
  }

  /**
   * Zone de réponse sous une annotation : Oui / Non pour une lecture douteuse, « ce n'est pas ce que j'ai écrit » sinon.
   * La précision (pastilles de confusions fréquentes + champ libre) est envoyée au tuteur, qui relit la ligne et met les annotations à jour.
   */
  function reponse(a: ItemAnnotation): HTMLElement {
    const zone = Object.assign(document.createElement('div'), { className: 'reponse' });
    if (!a.empreinte) {
      zone.append(Object.assign(document.createElement('p'), { className: 'dim', textContent: 'Touche « Corriger » pour pouvoir répondre sur cette ligne.' }));
      return zone;
    }
    const retour = Object.assign(document.createElement('div'), { className: 'retour' });
    const formulaire = Object.assign(document.createElement('div'), { className: 'formulaire' });
    formulaire.hidden = true;

    async function envoyer(texte: string) {
      zone.classList.add('occupe');
      ajouterMessage('eleve', texte, a.groupe);
      retour.className = 'retour attente';
      retour.textContent = 'Je relis la ligne…';
      try {
        const message = await hooks.onRepondre(a, texte);
        ajouterMessage('tuteur', message, a.groupe);
        rendreFil();
        retour.className = 'retour bulle';
        retour.replaceChildren(noteTexte(message));
        formulaire.hidden = true;
        zone.classList.add('fait');
        zone.previousElementSibling?.classList.add('perimee'); // l'annotation a été mise à jour sur la feuille
      } catch (e) {
        retour.className = 'retour echec';
        retour.textContent = `Impossible de relire la ligne : ${e instanceof Error ? e.message : e}`;
      } finally {
        zone.classList.remove('occupe');
      }
    }

    const champ = Object.assign(document.createElement('input'), { type: 'text', placeholder: "ex. : après le égal, c'est un x", maxLength: 300 });
    const pastilles = Object.assign(document.createElement('div'), { className: 'pastilles' });
    for (const groupe of CONFUSIONS) {
      const g = Object.assign(document.createElement('span'), { className: 'confusion' });
      for (const sym of groupe) {
        const p = Object.assign(document.createElement('button'), { type: 'button', textContent: sym });
        p.addEventListener('click', () => {
          champ.value = `${champ.value.trim() ? `${champ.value.trim()} ; ` : "c'est "}« ${sym} »`;
          champ.focus();
        });
        g.append(p);
      }
      pastilles.append(g);
    }
    const envoi = Object.assign(document.createElement('button'), { type: 'button', className: 'envoyer', textContent: 'Envoyer' });
    envoi.addEventListener('click', () => {
      const t = champ.value.trim();
      if (t) void envoyer(t);
    });
    champ.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && champ.value.trim()) void envoyer(champ.value.trim());
    });
    formulaire.append(Object.assign(document.createElement('p'), { className: 'question', textContent: "Qu'est-ce que tu as écrit ?" }), pastilles, champ, envoi);

    const actions = Object.assign(document.createElement('div'), { className: 'actions' });
    const bouton = (texte: string, fn: () => void, cls = '') => {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: texte, className: cls });
      b.addEventListener('click', fn);
      actions.append(b);
    };
    if (a.type === 'lecture_douteuse' && a.lu && a.propose) {
      const q = Object.assign(document.createElement('p'), { className: 'question' });
      q.append("J'ai lu ", formule(a.lu), ' : est-ce bien ', formule(a.propose), ' ?');
      zone.append(q);
      bouton('Oui, c\u2019est ça', () => void envoyer(`Oui : j'ai bien écrit « ${a.propose} » et non « ${a.lu} ».`), 'oui');
      bouton('Non', () => (formulaire.hidden = false), 'non');
    } else {
      bouton("Ce n'est pas ce que j'ai écrit", () => (formulaire.hidden = false));
    }
    zone.append(actions, formulaire, retour);
    return zone;
  }

  return {
    get visible() {
      return panneau.classList.contains('ouvert');
    },
    afficher(res: Resultat) {
      actif = null;
      // Entrée « image » : Claude lit la feuille lui-même, il n'y a pas de LaTeX lu à afficher.
      const lus = res.entree === 'image' ? [] : res.groupes.filter((g) => g.latex || g.statut === 'lecture_echouee');
      const echecs = lus.filter((g) => g.statut === 'lecture_echouee').length;
      const parId = new Map(res.groupes.map((g) => [g.id, g]));
      const noeuds: Node[] = [];
      if (res.erreurCorrection) {
        noeuds.push(Object.assign(document.createElement('p'), { className: 'echec', textContent: `Correction impossible : ${res.erreurCorrection}` }));
      }
      for (const a of res.annotations) {
        const ligne = ligneAnnotation(a, parId);
        const empreinte = a.groupe ? parId.get(a.groupe)?.empreinte : undefined;
        const item = empreinte ? etat.items.find((i) => i.empreinte === empreinte) : undefined;
        // Sous chaque annotation (sauf « ok » et remarque générale) : répondre ou préciser, sans passer par un appui sur la feuille.
        noeuds.push(ligne, ...(item && a.type !== 'ok' && a.type !== 'remarque_generale' ? [reponse(item)] : []));
      }
      if (res.annotations.length) {
        const brut = Object.assign(document.createElement('details'), { className: 'brut' });
        brut.append(
          Object.assign(document.createElement('summary'), { textContent: 'JSON des annotations' }),
          Object.assign(document.createElement('pre'), { textContent: JSON.stringify(res.annotations, null, 2) }),
        );
        noeuds.push(brut);
      }
      if (lus.length) noeuds.push(Object.assign(document.createElement('p'), { className: 'section', textContent: 'Lecture des lignes' }), ...lus.map(ligneLecture));
      liste.replaceChildren(...noeuds);
      corps.scrollTop = 0;
      const duree = res.dureeCorrection ? ` · correction ${Math.round(res.dureeCorrection)} s` : '';
      const lecture = res.entree === 'image' ? '' : ` · ${lus.length - echecs} ligne${lus.length - echecs > 1 ? 's' : ''} lue${lus.length - echecs > 1 ? 's' : ''}${echecs ? ` (${echecs} non lue${echecs > 1 ? 's' : ''})` : ''}`;
      titre.textContent = `${res.annotations.length} annotation${res.annotations.length > 1 ? 's' : ''}${lecture}${duree}`;
      ouvrir();
    },
    /** Détail d'une annotation touchée sur la feuille (la correction complète n'est pas conservée). */
    detail(a: ItemAnnotation) {
      actif = null;
      const g: GroupeLu = { id: a.groupe, x0: a.bbox[0], y0: a.bbox[1], x1: a.bbox[2], y1: a.bbox[3], latex: a.latex };
      const ligne = ligneAnnotation({ type: a.type, groupe: a.groupe, extrait: a.extrait, note: a.note, lu: a.lu, propose: a.propose, verifiee: a.verifiee }, new Map([[g.id, g]]));
      if (a.empreinte) {
        cible = { empreinte: a.empreinte, id: a.groupe };
        majPuces();
      }
      const noeuds: Node[] = [ligne, reponse(a)];
      if (a.latex) noeuds.push(Object.assign(document.createElement('p'), { className: 'section', textContent: 'Ligne lue' }), ligneLecture(g));
      for (const r of etat.remarques) {
        noeuds.push(Object.assign(document.createElement('p'), { className: 'section', textContent: 'Remarque générale' }), Object.assign(document.createElement('p'), { className: 'remarque' }));
        (noeuds[noeuds.length - 1] as HTMLElement).append(noteTexte(r));
      }
      liste.replaceChildren(...noeuds);
      corps.scrollTop = 0;
      titre.textContent = `Annotation · ${a.groupe}`;
      ouvrir();
      ligne.click(); // entoure la ligne sur la feuille
    },
    /** Discussion libre : ouvre le panneau sur le fil et le champ de message. */
    ouvrirDiscussion() {
      actif = null;
      if (!liste.children.length) {
        liste.replaceChildren(
          Object.assign(document.createElement('p'), {
            className: 'section',
            textContent: 'Écris un message au tuteur ci-dessous. Pour parler d\u2019une ligne, touche son annotation ou entoure-la avec « Montrer une zone ».',
          }),
        );
      }
      titre.textContent = 'Discussion';
      ouvrir();
      champMsg.focus();
    },
    /** La feuille signale le nombre de traits entourés au lasso (0 = sélection retirée). */
    majZone(n: number) {
      zoneN = n;
      if (n > 0) {
        zoneArmee = false;
        panneau.classList.remove('discret');
      }
      majPuces();
    },
    /** Remplit le champ (chargement de la feuille) sans déclencher de sauvegarde. */
    setEnonce(texte: string) {
      enonceChamp.value = texte;
      majResume();
    },
    /** Ouvre le panneau sur le seul champ d'énoncé (avant de corriger). */
    ouvrirEnonce() {
      actif = null;
      if (!liste.children.length) {
        liste.replaceChildren(Object.assign(document.createElement('p'), { className: 'section', textContent: "Les corrections s'afficheront ici." }));
      }
      titre.textContent = 'Énoncé';
      enonceBloc.open = true;
      ouvrir();
      enonceChamp.focus();
    },
    /** Changement de page : on oublie la correction affichée, la ligne visée et la zone montrée. */
    reinitialiser() {
      actif = null;
      cible = null;
      zoneArmee = false;
      zoneN = 0;
      panneau.classList.remove('discret');
      liste.replaceChildren();
      photoMsg.textContent = '';
      majPuces();
    },
    /** Redessine les miniatures (page chargée ou importée). */
    majPhotos,
    masquer() {
      actif = null;
      panneau.classList.remove('ouvert');
    },
  };
}
