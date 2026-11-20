# Tutorat — contexte du projet (sauvegarde du 30/10/2026, fin de session)

L'utilisateur parle français et préfère des réponses courtes. Il teste sur **iPad + Apple Pencil** : à la fin de chaque
étape, lui dire précisément quoi tester. Ne jamais affirmer qu'un test iPad est passé sans qu'il l'ait confirmé.

## 0. Reprise rapide (fin de session, 30/10/2026)

- **Validé sur iPad par l'utilisateur** : l'app de base ; le bouton Corriger ; les annotations dessinées ; la réponse aux lectures douteuses et les précisions (jalon 1) ; la discussion, la zone au lasso et l'historique (jalon 2, « ça marche »).
- **Pipeline de production** : `config.toml [correction] entree = "image"` (bandes de la feuille, groupes encadrés et numérotés, `claude -p` avec l'**abonnement Claude Pro**, effort par défaut, sans 2e passe). TexTeller n'est plus chargé ; la lecture de fond et le cache sont inactifs en mode image mais restent disponibles (`entree = "ocr"`).
- **Lancer** : `npm.cmd run reco` (serveur de l'app, port 8765, HTTPS mkcert) + `npm.cmd run pwa` (app, port 4173) ou `npm.cmd run dev` (5173). Rien n'est lancé par Claude en fin de session.
- **Idées pour la suite** (rien n'est commencé) : (1) décider de retirer ou garder en repli TexTeller / `/lire` / cache ; (2) ne corriger que les lignes modifiées depuis la dernière correction (quota Pro) ; (3) affichage progressif dans le panneau ; (4) exploiter `bench-reco/corrections_lecture/` (entrées réelles : image d'une ligne + ce que l'élève dit avoir écrit) pour évaluer la lecture ; (5) vérifier G11 de feuille_2 (signe peut-être réellement oublié) ; (6) les notes de feuille_2 n'ont pas été exportées.
- **Règles de conduite** : réponses courtes en français ; toujours dire précisément quoi tester sur l'iPad ; plan avant un gros développement ; comparaisons **en aveugle** (ne rien révéler avant les notes) ; ne jamais définir `ANTHROPIC_API_KEY` (facturation au token).

## 0 bis. Session du 31/10/2026 — pages, photos d'énoncé, correction partielle (code fait, build OK, 33 tests verts, **NON testé sur iPad**)
- **Pages (cahier)** : `src/pages.ts` (index IndexedDB clé `pages`, `cle(base)` : la page `p1` garde les clés d'origine `feuille`/`annotations`/`precisions`/`conversation`, les autres `base:<id>` ; + `photos`), `src/ui/pages.ts` (panneau : nouvelle, ouvrir, renommer ✎, supprimer avec 2e appui),
  bouton « Pages » dans la barre. `main.ts` : `chargerPageCourante()`, `changerDePage()` (refusé pendant une correction/discussion : compteur `reseau`), les loaders (annotations, précisions, conversation, photos) repartent d'un état vide. L'export JSON porte le nom de la page.
- **Photos d'énoncé** : `src/photos.ts` (JPEG ≤ 1600 px, data URL, max 6 par page, IndexedDB `photos`, incluses dans l'export/import JSON), `src/ui/photo.ts` (visionneuse plein écran : glisser = déplacer, pincer/molette = agrandir, Ajuster, **Recadrer** à 8 poignées, Supprimer), ajout dans le bloc Énoncé du panneau (miniatures).
  Envoyées dans `options.photos` à `/corriger` et `/discuter` ; serveur `_photos()` les écrit en `enonce_N.ext` et Claude les lit avec Read (`CONSIGNE_PHOTOS`). Pas (encore) de photo épinglée/déplaçable **sur la feuille** : le déplacement/agrandissement est dans la visionneuse.
- **Photo posée sur la feuille** (même jour, non testée iPad) : `Photo.pos = {x, y, l}` (unités feuille). Panneau Énoncé → toucher une miniature → visionneuse → « Placer sur la feuille ». `src/render/photos.ts` (calque d'`<img>` entre le fond et l'encre, `pointer-events: none`), `src/ui/photo-cadre.ts` (cadre d'édition : glisser le corps = déplacer, coins = redimensionner proportionnellement, boutons Recadrer / Retirer / OK ; les événements du cadre ne remontent pas à la feuille).
  Sélection : appui bref du doigt sur la photo (même détection que les annotations) ; le stylet qui recommence à écrire ou un appui ailleurs désélectionne. Recadrage sur la feuille : le contenu garde sa taille et sa place (`recadrerPhoto` ajuste x, y, l). La hauteur de la feuille tient compte des photos. Les photos n'apparaissent pas dans les images envoyées à Claude (elles partent à part, comme avant).
  **Pièges trouvés** : (1) `Object.assign(el, { dataset: … })` plante (dataset en lecture seule) → écran blanc ; (2) `root` annule `touchstart`/`click` (anti double-tap Safari, `main.ts` fin) : tout bouton placé DANS `#sheet` doit stopper ces événements (fait dans `photo-cadre.ts`), sinon ses clics sont perdus.
  **Test tactile sans iPad** : Edge `--headless=new --remote-debugging-port=9333` + script Node 22 (WebSocket global, CDP `Input.dispatchTouchEvent`), IndexedDB amorcée par `Runtime.evaluate` (clé `photos`) ; `vite preview --port 4199` est en HTTPS (`--ignore-certificate-errors`).
- **Cours généré par Claude — étape 1 faite (testée PC/headless + 1 vrai appel serveur, pas iPad)** : plan validé en 3 étapes (1 génération + demandes écrites ; 2 « Faire cet exercice » = nouvelle page avec énoncé auto + encart sur la feuille ; 3 suivi : statuts automatiques depuis la correction, adaptation de la difficulté, écran de progression). Niveau par défaut 1re année d'école d'ingénieur (modifiable par cours) ; avec photos Claude peut traiter d'autres matières ; graphiques plus poussés plus tard. Solutions masquées, « Voir la solution » = « réussi avec aide ».
  Serveur : `bench-reco/cours.py` (`elaborer`, schéma `{message, titre, sections[{titre,texte}], exercices[{enonce,difficulte 1-3,indice,solution}]}`, texte avec `$…$` sans Markdown, 1 relance) + endpoint `POST /cours` (`options.mode` = `creer` | `modifier`, `photos` acceptées ; erreur → `erreur_cours`). Essai réel : création 28 s, ajout de 2 exercices 23 s.
  App : `src/cours.ts` (IndexedDB clé `cours`, GLOBAL, pas par page ; statuts `a_faire|en_cours|reussi|avec_aide|erreurs`), `src/ui/cours.ts` (panneau : liste, formulaire, lecture, indice/solution dépliables, champ de demande), `reco.elaborerCours`, bouton Cours dans la barre. Le suivi (étape 3) devra écrire `reussi`/`erreurs` via `definirStatut`.
- **Cours = une page « écrite à la main » (étape A faite, testée Edge headless + 1 vrai cours, pas iPad)** : un cours généré crée une page du cahier (`InfoPage.coursId`, `Cours.pageId`) où le texte est posé en **blocs** (`src/blocs.ts`, IndexedDB `blocs` par page ; `render/blocs.ts` : police Caveat bleu marine, formules KaTeX, calque `#blocs-feuille` sous l'encre) : titre, sections, puis chaque exercice (`type: exercice`) suivi d'un **espace de réponse** pointillé « à toi ✎ » (260/340/440 unités selon la difficulté).
  `src/page-cours.ts` construit les blocs ; `ajouterEnBas()` mesure (`mesurerTexte`, polices KaTeX préchargées par une sonde sinon chevauchements) et empile. Toucher le texte d'un bloc au doigt → `ui/bloc-cadre.ts` : déplacer, largeur par les coins du bas, boutons Indice / Solution (ouvrent le panneau Cours sur l'exercice ; la solution = « réussi avec aide ») / **+ de place** (`insererPlace` : allonge l'espace de réponse de 200 et décale blocs, photos, tracés (`Store.decaler`, sans historique) et annotations — les lignes décalées changent d'empreinte : leurs annotations perdent le lien de réponse, la correction partielle les refera) / OK ; Supprimer pour les blocs de texte.
  Panneau Cours : création → `onCoursCree` (page + blocs) ; vue d'un cours = bouton « Ouvrir la page du cours » + liste d'exercices (indice, solution, statut) + demandes écrites ; une demande qui ajoute des exercices/sections les écrit **en bas de la page du cours** (`ajouterAuCours`). Un cours d'avant (sans page) s'écrit à l'ouverture.
  La correction/discussion reçoit `options.blocs` (énoncé + zone de réponse de chaque exercice ; `CONSIGNE_BLOCS`) : les lignes écrites dans la zone répondent à cet énoncé. Les blocs sont aussi dans l'export/import JSON.
  **Étape B faite (testée Edge headless + vrai appel sur feuille_3, pas iPad)** : Claude peut **écrire une explication à la main sous une ligne** : champ facultatif `explications: [{groupe, texte}]` (3 max, 900 car., `CONSIGNE_EXPLICATIONS` dans `prompt_systeme`, `valider_explications`) dans les réponses de `/corriger` et `/discuter` (côté discussion : `{empreinte, texte}`). L'app (`poserExplications` dans `main.ts`) mesure le texte, **fait de la place** (`decalerSous` : blocs, photos, tracés par leur centre, annotations ; allonge l'espace de réponse de l'exercice concerné), puis pose un bloc `type: tuteur` (rouge, étiquette « ✎ Le tuteur », déplaçable/supprimable comme les autres). De bas en haut pour garder les positions justes. `silencieux` empêche la fermeture du panneau pendant ces décalages.
  **`pipeline.empreinte` est maintenant invariante par décalage vertical** (le haut du groupe sert d'origine y ; x reste absolu) : une ligne descendue garde son empreinte, donc annotations, précisions et correction partielle restent valides. Effet unique de ce changement : les annotations/précisions/`vues` enregistrées avant sont obsolètes (« Touche Corriger pour pouvoir répondre », une correction complète la 1re fois). Piège de test : `.bloc.mesure` (élément de mesure) porte aussi la classe du type → l'exclure des comptages.
  **Reste à faire** : **(C)** suivi automatique des statuts par la correction + difficulté adaptative + écran de progression. Les cours ne comptent pas encore dans « Crédits utilisés ».
- **Consommation par page** (menu ⚙, tout en haut : « Crédits utilisés · Page N : x appels · y k tokens · ≈ z $ ») : `src/usage.ts` (IndexedDB `usage` par page, supprimée avec la page), alimentée par les `tentatives` (tokens, coût équivalent tarif public) renvoyées par `/corriger` et `/discuter`. Les cours ne comptent pas encore. Avec l'abonnement Pro c'est un équivalent, pas une facturation.
- **Correction partielle** (réglage ⚙ « Lignes corrigées » : Nouvelles ou modifiées *(défaut)* / Tout revérifier) : l'app envoie `options.deja_corrigees` (= `annotationsEtat.vues`, empreintes de toutes les lignes de la dernière correction) ; le serveur marque ces groupes `deja_corrige`, Claude n'annote que les autres (garde-fou : annotations sur lignes inchangées supprimées),
  l'app garde les annotations des lignes inchangées (`poserAnnotations(..., inchangees)`). Si rien n'a changé : `rien_de_nouveau`, **aucun appel à Claude** (0,6 s). Essai réel (feuille_2, 2 lignes à refaire) : seules G15 et G16 annotées, 8 s. Les groupes de bruit (sans empreinte) sont ignorés. La réponse porte `empreintes` (toutes les lignes, y compris figures/règles).
- Piège : un heredoc bash contenant des apostrophes françaises a fait échouer tout un lot d'écritures (rien d'appliqué) → écrire un fichier .py avec Write/cat quoté puis l'exécuter, ou utiliser Edit.

## 1. L'app (canvas d'écriture) — terminée, validée sur iPad

PWA Vite + TypeScript vanilla, `perfect-freehand`, `idb-keyval`, `vite-plugin-pwa`. Code dans `src/`.

- **Fonctions** : stylet seul dessine ; 1 doigt = défilement, 2 doigts = zoom ; rejet de paume (contact > 115 px ignoré,
  doigts ignorés 350 ms après le stylet) ; 4 calques (page CSS, encre en cache, annotations (cercles, coches, soulignements posés par la correction), trait en cours) ;
  gomme (trait entier), lasso (sélection/déplacement/suppression), annuler/rétablir ; barre flottante déplaçable
  (8 couleurs, 2 épaisseurs, « Corriger » = correction par Claude, bulle = discussion, document = énoncé, œil = masquer les annotations, réglages).
- **Extras demandés** : gribouiller sur un tracé l'efface (`src/tools/scribble.ts`) ; maintenir le stylet immobile 550 ms redresse
  en droite ou quadratique de Bézier (`src/tools/shape.ts`). Les deux ont une bascule dans les réglages.
- **Sauvegarde auto** IndexedDB (0,6 s après modification) ; export/import JSON ; fond blanc / carreaux / ligné.
- **Format d'export** : `{ version, largeur: 800, fond, traits: [{ id, couleur, epaisseur, outil, debut, fin, points: [[x,y,pression,t]] }] }`,
  coordonnées en unités feuille (largeur 800), `t` en ms.
- **Pas de bouton « Nouvelle feuille »** (proposé, non demandé) : on vide en important un JSON vide.

### Lancer
- PowerShell bloque `npm.ps1` : utiliser **`npm.cmd run dev`** (port 5173, ou 5174 si occupé) ou **`npm.cmd run pwa`** (build + prévisualisation port 4173,
  seul endroit où le service worker tourne).
- HTTPS de confiance : **mkcert installé**, certificat dans `certs/` (IP du PC **192.168.1.53** ; à régénérer si elle change :
  `mkcert -cert-file certs/dev.pem -key-file certs/dev-key.pem localhost 127.0.0.1 <IP>`). La CA est installée sur l'iPad.
- Wi-Fi du PC en profil « Public » : règle pare-feu « Vite dev » créée ; si l'iPad ne se connecte pas, vérifier d'abord que le serveur tourne.
- Aucun serveur n'est lancé en arrière-plan par Claude à la fin de la session.

## 2. Banc de reconnaissance — `bench-reco/` (Python 3.11, venv `.venv`, CPU)

Objectif initial : mesurer si Pix2Text (MFR seul) et TexTeller lisent les maths manuscrites de l'app. **Ce dossier est devenu le serveur local de l'app** (`serveur.py`, voir ci-dessous) et le banc d'essais de la correction (`comparer_effort.py`).
Lire `bench-reco/README.md` (méthode, limites, licences). Lancement :
`bench-reco\.venv\Scripts\python bench-reco\bench.py feuille.json [--verite verite.json] [--sans-reco]` → `bench-reco/sorties/<nom>/rapport.html`.
`--sans-reco` = regroupement + rendu seulement (secondes) pour régler `config.toml` (seuils relatifs à la hauteur d'un caractère `h`).

**État** : 30 tests verts (`python -m pytest tests` depuis `bench-reco/`, SANS `-I`) ; lancé sur les vraies feuilles 1, 2 et 3 (résultats plus bas).

Résultats sur 6 lignes **synthétiques** (indicatifs, ne mesurent pas l'écriture réelle) : TexTeller 6/6 exact, ~1,4 s/ligne ;
Pix2Text mfr-1.5 4/6 exact (somme lue comme tableau, `x` lu `\times`), ~0,35 s/ligne. La hauteur d'image (128/256) ne change rien :
les modèles redimensionnent dans un carré fixe, c'est le rapport largeur/hauteur qui compte. La confiance de Pix2Text (96–100 %) ne signale pas ses erreurs.

**Licences** (détail dans le README) : poids Pix2Text MIT, TexTeller Apache-2.0 (données d'entraînement OpenRAIL). `pip install pix2text` apporte
5 paquets AGPL (`ultralytics`, `doclayout-yolo`, `pymupdf`…) + `Unidecode` (GPL) **réellement chargés** à l'import ; `import texteller` n'en charge aucun.
Modèles Pix2Text `mfr-pro`/`mfr-plus` et variantes PyTorch = payants.

### Données de test fournies par l'utilisateur (hors dépôt)
Dossier : `C:\Projet_Programmation_EPFL\ia\reconnaissance_de_texte\`
- `feuille_1.json` — feuille de test demandée (431 traits, noir, fond blanc) ; vérité : `verite_1.tex`.
- `feuille_2.json` — vraie séance d'exercices et sa correction (362 traits, noir **+ bleu** `#1a56db`) ; vérité : `verite_2.tex`.
- Les `.tex` sont des **documents LaTeX complets**, pas le `verite.json` attendu par le banc (`{"G1": "latex", …}`, clés = ids du rapport, de haut en bas).
  Il faut les convertir ligne par ligne vers les groupes.
- Contenu non lisible par des modèles de *formules* : phrases en français (« Il en faut peu… », « Les wafers dopés… », « 3) Intercorrélation… »),
  `\text{cette fraction est dure}` dans une formule, figures **TikZ** (fonction `rect`, peigne de Dirac). À exclure du score ou à noter à part.
- Cas durs présents : intégrale multiple sur 3 égalités (très longue ligne), matrice, système à accolade, `\begin{array}`, intégrales à bornes infinies,
  `\Big[ … \Big]_0^t`, signes ressemblants (`x \times 2`, `1 \ell`, `0 o`, `u v`, `g \gamma`).
- ⚠ Fichiers lourds (6,9 et 4,6 Mo) : ne pas les afficher en entier.

### Résultats sur les vraies feuilles (29/10/2026) — étapes 1 à 3 faites
Regroupement corrigé (`groupement.py` + `config.toml` : grands symboles détectés sur caractères soudés, barre de fraction jamais « borne », règles de séparation
ignorées mais numérotées, `ligne_ecart_grand_h`). `bench-reco/verite_1.json` (18 groupes notés) et `verite_2.json` (11) écrits ; lancer :
`bench.py ../feuille_N.json --verite verite_N.json` (feuilles copiées à la racine du projet). Rapports dans `bench-reco/sorties/feuille_N/`.
- **TexTeller** : CER médian 0,05 (feuille 1) et 0,00 (feuille 2), 8/18 et 6/11 exacts, ~1,6 s/ligne.
- **Pix2Text mfr-1.5** : CER médian 0,18 et 0,15, 3/18 et 4/11 exacts, ~0,3 s/ligne.
- Erreurs TexTeller : `x` lu `n`, `2` lu `z`/`r` en exposant, `2x-5` lu `2x\cdot5`, `\{` sans `\right.`, grande ligne d'intégrales (CER 0,67).
- Limites : 29 groupes notés, un seul scripteur ; ligne `f(t)=\sum…` fusionnée avec la figure TikZ (non notée).

### Décision (29/10/2026)
On part sur **TexTeller** pour l'instant ; pas de recherche d'un modèle manuscrit pour le moment.

### Intégration dans l'app (29/10/2026) — code fait, **validé sur iPad par l'utilisateur** (panneau affiché, lecture correcte)
Bouton « Corriger » → `src/reco.ts` POST la feuille à `bench-reco/serveur.py` (HTTPS mkcert, port 8765, `npm.cmd run reco`) → groupes + LaTeX →
panneau `src/ui/resultats.ts` (KaTeX, `npm install katex`) + cadre `#surligne` sur la feuille. Il **lit** seulement (pas de vraie correction de fond).
Le calque `annotations` reste vide. Port 8765 joignable depuis l'iPad (HTTPS mkcert OK). Non testé : surlignage au toucher d'une ligne, fermeture du panneau à l'écriture, message d'erreur serveur arrêté.

### Correction par Claude (30/10/2026) — étape (a) faite et **validée sur iPad par l'utilisateur** (« marche du feu de dieu », un peu lent : ~26 s de lecture TexTeller + ~12 s Claude) ; (b) rendu sur calque, (c) 2e passe image, (d) réglages/lasso/énoncé restent à faire
Plan validé par l'utilisateur (types d'annotations : ok / erreur / indice / lecture_douteuse / remarque_generale ; erreur douteuse → `lecture_douteuse`).
- `bench-reco/correction.py` : prompt, schéma plat + `valider()` (1 relance), backends `claude-cli` (défaut, `claude -p` avec l'abonnement) et `api`
  (SDK anthropic, écrit **non essayé**). Réglages dans `config.toml` `[correction]` (modèle `claude-sonnet-5-5`, mode, ton, `ignorer_couleurs`).
  **Piège** : `claude -p` nu charge ~160 000 tokens (plugins/outils) ; les flags `--setting-sources "" --strict-mcp-config --disable-slash-commands
  --tools "" --system-prompt …` ramènent à ~1 100 tokens (3–12 s). `--bare` ne marche pas avec l'abonnement.
- `bench-reco/pipeline.py` : lecture partagée (tous les groupes envoyés, `type_probable` = indication seulement, `lecture_fiable`).
- `serveur.py` : `/corriger` accepte `options` (`ignorer_couleurs`, `mode`, `ton`, `enonce`, `lecture_seule`) ; renvoie groupes + annotations ou `erreur_correction`.
- Journaux locaux `bench-reco/logs/<horodatage>/` (hors dépôt) : requête, prompt, réponse brute, durées, taille, coût.
- Essai hors app : `bench-reco\.venv\Scripts\python bench-reco\essai_correction.py feuille_2.json --ignorer "#1a56db"` → `sorties/correction_feuille_2/rapport.html`.
- `feuille_2.json` : les 12 traits bleus (#1a56db) sont la correction de l'utilisateur sur les **figures** (créneau rect, peigne) — pas sur les lignes de calcul.
- App : le panneau liste les annotations (badge, note KaTeX, JSON brut) ; `?ignorer=%231a56db` dans l'URL de l'app ignore le bleu.
- **Étape (b) faite (code + capture Edge headless, non testée sur iPad)** : `src/annotations.ts` (état + IndexedDB clé `annotations`, séparé des traits ;
  `signature` = traits sous la boîte → annotation estompée si elle change), `src/render/annotations.ts` (calque canvas : cercle rouge à main levée = erreur,
  coche verte = ok, soulignement orange = indice, pointillé violet = lecture douteuse, tremblé à graine fixe), `src/ui/notes.ts` (notes HTML en marge droite,
  police Caveat `@fontsource/caveat/latin-500.css`, KaTeX via `src/ui/latex.ts`, évitent encre et autres notes, repli sous la ligne),
  bouton œil dans la barre (masquer/afficher, visible seulement s'il y a des annotations), « Effacer les annotations » dans les réglages,
  toucher (doigt) une note/cercle/coche ouvre `resultats.detail()`. Les remarques générales restent dans le panneau.
- **Étape (c) faite (testée sur PC, pas sur iPad)** : `correction.verifier_erreurs()` revérifie chaque `erreur` sur l'image du groupe (rendu 128–384 px, largeur ≤ 1500,
  `claude -p --tools Read` dans un dossier temporaire, appels en parallèle, `[correction] verification*` dans config.toml). Verdicts : `confirmee` → gardée (`verifiee: true`),
  `lecture` → devient `lecture_douteuse` (lu/propose, sans note), `juste` → disparaît, vérification impossible → gardée (`verifiee: false`). Journal : `verif_Gn.png/_requete.txt/_reponse_brute.json`,
  `verification.json`. Essais : feuille_1 → vraie erreur (G12 : `Σ_{k=1}^{n}` sans `k`) confirmée ; feuille_2 avec fausses erreurs fabriquées → G9 devient lecture douteuse (`τ` lu `t`), G7 disparaît.
  Lecture TexTeller de feuille_1 = ~100 s (25 groupes, texte compris) : lenteur à traiter plus tard (parallélisme, ONNX, ne pas lire les groupes « texte »).
- **Étape (d) faite (code + essais PC, non testée sur iPad)** : réglages (menu ⚙ : mode tout / sans_solution / indice / resultat_final, zone feuille / sélection lasso, ton bref / détaillé ;
  localStorage `tutorat.correction`) envoyés dans `options` ; zone « sélection » = seuls les traits sélectionnés sont envoyés et seules les annotations recouvrant la sélection sont remplacées ;
  champ « Énoncé » dans le panneau (bouton document de la barre), stocké dans `Feuille.enonce` (IndexedDB + export/import JSON), max 4000 car., envoyé à Claude ; `persister()` = sauvegarde sans fermer le panneau.
  Essai des modes sur feuille_1 (une lecture, 6 appels) : indice → 1 seul `indice` ; resultat_final → 1 seul `ok` ; détaillé → notes plus longues ; le mode ne change que le prompt.
  **Variabilité** : la ligne `Σ_{k=1}^{n}` sans `k` est tantôt `erreur` (confirmée en 2e passe), tantôt `lecture_douteuse` d'un run à l'autre — normal avec un LLM.
- **Vitesse (30/10/2026)** — mesure : sur feuille_1, 88 s de lecture dont **51 s pour un seul groupe** (G25, texte) qui bouclait jusqu'à 1 024 tokens ; encodeur ~0,57 s/groupe, décodeur ~47 ms/token ;
  parsing/regroupement/rendu < 1 s ; modèle chargé une fois (8 s au démarrage) ; torch = 6 threads (cœurs physiques) ; TexTeller utilisait déjà `num_beams=1` (glouton).
  Fait : (1) plafond adaptatif `20 + 2,5 × largeur/h` (borné 24–400, ≥1,5× de marge sur les groupes notés) et (2) arrêt sur boucle (n-gramme répété > 3 fois, 8 pour un token) dans `reco.TexTeller.lire(img, max_tokens)` ;
  un groupe arrêté est `lecture_echouee` (raison boucle/plafond), transmis à Claude comme non lu (`latex: null`) et affiché « Ligne non lue » dans le panneau.
  Banc avant/après : CER **identique** sur les 29 groupes notés, lecture 101→38 s (feuille_1) et 29→24 s (feuille_2), G25 → `lecture_echouee (boucle)` à 32 tokens (2 s au lieu de 59 s). Les lignes de TEXTE restent capricieuses
  (en format léger c'est G22 qui boucle, à 274 tokens ≈ 13 s) : normal, ce ne sont pas des formules.
  (4) Cache par empreinte (`pipeline.empreinte` : géométrie des traits arrondie au dixième, LRU 3000, en mémoire serveur) + lecture en arrière-plan : l'app envoie le **format léger** (`versFeuilleLegere` : id, couleur, début/fin,
  points x,y au dixième ; 0,9 Mo au lieu de 6,9 Mo) à `/lire` 2,5 s après la dernière modification (stylet levé, debounce, une seule requête, abort à chaque changement) ; le serveur regroupe lui-même (aucune logique de groupes côté app),
  lit les groupes inconnus et s'arrête si une requête plus récente ou une correction arrive. `/corriger` n'a plus qu'à lire les groupes absents du cache. Mesures : relecture en cache 0,7 s ; `/corriger` feuille_2 après `/lire` ≈ 17 s (avant 41 s).
  **Non fait** : cache côté app, affichage progressif dans le panneau, comparaison `--effort low` (prévue quand la lecture sera en arrière-plan : comparer les annotations avec la correction bleue de feuille_2).
  **Non testé sur iPad.** Testé : banc, serveur réel (curl), déclenchement `/lire` par traits simulés dans Edge headless.
- **Comparaison en aveugle des configurations de correction (30/10/2026)** : `bench-reco/comparer_effort.py` (feuille_2, bleu exclu, lecture TexTeller figée depuis `sorties/effort_feuille_2/runs_lot1.json`).
  5 configs (A–E tirées au hasard, mapping dans `runs.json`, révélé par le bouton du rapport) : OCR effort low / OCR effort défaut / image seule page entière / image seule 3 bandes / OCR + image,
  × modes tout & indice × 3 exécutions (30 appels, tous réussis). `claude -p --effort` existe bien (low, medium, high, xhigh, max) ; les configs image utilisent l'effort par défaut.
  Images : `page_image.py` (cadres magenta numérotés, étiquettes à gauche, grand côté ≤ 1568 px). `correction.corriger(..., images, entree)` : entrée `ocr|image|ocr_image`, tokens d'entrée totaux (cache de prompt compris).
  À faire par l'utilisateur : remplir `bench-reco/reference_feuille_2.json` (champ « erreur »), noter les annotations 1–3 dans `rapport.html`, révéler, exporter ; puis `comparer_effort.py --rapport` (rappel / fausses alertes).
  **Ne pas communiquer le mapping A–E ni les chiffres par configuration avant que l'utilisateur ait noté** (évaluation en aveugle).
  Ajout (même jour) : config **F = image page entière, effort low** (`--ajouter image_page_low` : étiquettes A–E et clé de notes inchangées, référence non touchée, 6 essais ajoutés après les 30 premiers = autre fenêtre de temps) ;
  récapitulatif : temps de vérification à part, « 2e passe : lancées / écartées », bout en bout avec et sans vérification.
- **feuille_2 = entièrement juste** (dit par l'utilisateur) : référence laissée vide ; seules les fausses alertes et les notes de qualité comptent, rappel non mesurable.
  **feuille_3 (fautes volontaires, en attente)** : l'utilisateur écrit sur l'iPad les 12 lignes de `bench-reco/feuille_3_a_ecrire.html` (5 fausses : lignes 2, 4, 7, 10, 12 ; noir seulement, une ligne par groupe), exporte `feuille_3.json` à la racine ;
  `bench-reco/plan_feuille_3.json` pré-remplit `reference_feuille_3.json` si 12 groupes sont lus. Lancer : `comparer_effort.py --feuille feuille_3` (lit TexTeller une fois → `sorties/effort_feuille_3/lecture_figee.json`, puis 6 configs × 2 modes × 3).
  `comparer_effort.py` est paramétrable (`--feuille`, `--ignorer`, `--ajouter`, `--rapport`, `--apercu-images`) ; la 2e feuille aura ses propres étiquettes aveugles.
- **RÉSULTATS de la comparaison (feuille_3, 12 lignes, 6 fautes dont G3 « lim = … » ajoutée par l'utilisateur ; 6 configs × 2 modes × 3 exécutions ; notes 1–3 de l'utilisateur, 105 notes)** — détail : `bench-reco/sorties/effort_feuille_3/synthese.md`
  (`comparer_effort.py --feuille feuille_3 --synthese ~/Downloads/notes_effort.json`). Mode « tout corriger » : rappel OCR 50 % (low = défaut) ; OCR + image 72 % ; image page entière 83 % ; image 3 bandes 94 % (seule à voir G3 : 2/3) ;
  image page entière effort low 83 %. 0 fausse alerte sur feuille_3 pour toutes. Notes moyennes : OCR 1,8–1,9 ; OCR+image 2,1 ; image 2,2–2,3. **Le mode image bat l'OCR** (et OCR+image est moins bon que image seule : le texte OCR induit Claude en erreur, ex. `*` lu `+`).
  **Effort low : aucun gain** (aussi lent ou plus : OCR 28 s contre 25 s, image 30 s contre 28 s ; même rappel, notes ≤) → garder l'effort par défaut.
  **2e passe (vérification) redondante en mode image** : 47/47 erreurs confirmées, 0 écartée, ~17 s sur ~28 s ; en mode OCR elle a écarté 3 vraies fautes (G10, `*` lu `+` → lecture douteuse). Sans elle : image ≈ 11 s de Claude.
  Sur feuille_2 (jugée « toute juste » par l'utilisateur) les configs image émettent ~1 fausse alerte/exécution (G10 `-2t+τ` lu `-2τ+τ` ; G11 « il manque un signe » : l'OCR lit aussi `e^{-t}e^{-2t}` sans signe → faute réelle possible que l'utilisateur doit vérifier sur sa feuille) alors que l'OCR émet des lectures douteuses à la place.
  Les notes de feuille_2 n'ont pas été exportées (fichier écrasé). Échantillon petit (1 scripteur, 26 lignes, 3 exécutions) : différences de notes (0,1–0,4) non significatives, écarts de rappel nets.
  **Décision en attente** : adopter l'entrée image (3 bandes, effort défaut, sans vérification) comme pipeline principal de correction dans l'app (TexTeller/lecture de fond/cache deviendraient facultatifs).
- **DÉCISION VALIDÉE (30/10/2026) : entrée IMAGE en production** (`config.toml [correction] entree = "image"`, `bande_hauteur_h = 24`, `bandes_max = 8`, `verification = false`, effort par défaut).
  Le serveur regroupe (code inchangé), dessine la feuille en bandes (`page_image.nb_bandes/rendre_page` : traits noirs, groupes encadrés en magenta et numérotés = ids renvoyés à l'app), appelle `claude -p` avec ces images (outil Read) ; **TexTeller n'est plus chargé** (démarrage immédiat),
  `/lire` répond `{inactif: true}` (l'app cesse la lecture de fond), la réponse contient `entree: "image"` et les groupes sans LaTeX ; le panneau n'affiche plus « Lecture des lignes ». `entree = "ocr"` / `"ocr_image"` + `verification = true` restent disponibles (repli).
  Annotations inchangées : mêmes types, mêmes cercles/coches/notes dessinés sur le calque. `type_probable` sans OCR = seulement règle/figure/formule (plus « texte »).
  Validation du chemin de production (serveur HTTP, `sorties/test_mode_image.py`) : feuille_3 → 5/6 fautes trouvées ×3 (G3 manquée), 0 fausse alerte, **11 s** par correction ; feuille_2 → 0,7 fausse alerte/exécution (G10 `t`/`τ`, G11 signe), 13–15 s.
  **Coût** (équivalent tarif public, mode « tout ») : image sans vérification ≈ 0,037 $ ; image avec vérification 0,075 $ ; OCR avec vérification 0,036 $. **Abonnement** : `claude auth status` → `authMethod: claude.ai`, `subscriptionType: pro`, aucune variable ANTHROPIC_API_KEY/AUTH_TOKEN/BASE_URL → pas de facturation à l'appel, mais usage décompté du quota Pro.
  **⚠ Si `ANTHROPIC_API_KEY` est définie un jour dans l'environnement, `claude -p` l'utilisera à la place de l'abonnement (facturation au token).**
  **Tests pytest : `python -m pytest tests` SANS `-I`** (avec `-I` les modules du dossier ne sont pas trouvés) ; 30 tests.
- **Chantier 2, jalon 1 FAIT (a + b), testé sur PC (UI en Edge headless + vrai serveur), PAS sur iPad** : en entrée image il n'y a plus de LaTeX à corriger → la précision de l'élève est du texte libre.
  Serveur : `discussion.py` (`reprendre`, schéma `{message, annotations, retirer, lecture_corrigee}`), endpoint **`/discuter`** (reçoit la feuille légère + `options.precision/message/cibles/zone_traits/annotations_actuelles/precisions/historique` ; regroupe, génère bandes + gros plan des lignes ciblées + zone montrée,
  appelle Claude (~8 s), renvoie message + annotations à remplacer + `retirer` (empreintes) + position des groupes) ; chaque groupe a une **`empreinte`** (géométrie arrondie) qui identifie la ligne tant qu'elle n'est pas réécrite ; `/corriger` accepte `options.precisions` (champ `precision_eleve` + consigne « fait foi »).
  Essais réels : G10 `t`/`τ` → erreur retirée (remplacée par ok) ; vraie faute G4 maintenue et expliquée ; question sur G7 → réponse + annotation maintenue ; empreinte périmée → message immédiat sans appel Claude.
  `corrections_lecture/` (local, `.gitignore`) : image de la ligne + précision + `lecture_corrigee` LaTeX renvoyée par Claude, écrits à chaque précision (les entrées de test ont été supprimées).
  App : `src/precisions.ts` (précisions liées à l'empreinte, IndexedDB `precisions`, élaguées à chaque correction de toute la feuille), `reco.discuter`, `annotations.appliquerReprise`, panneau détail : « J'ai lu … : est-ce bien … ? » **Oui / Non**, « Ce n'est pas ce que j'ai écrit », pastilles de confusions (x × n / 2 z / 1 ℓ l / 0 o / u v / g γ / 5 s / t τ / − · =) + champ libre (Scribble iPadOS) + **Envoyer** ; l'ancienne annotation est grisée « remplacée sur la feuille ».
  Limite : seules les lignes **annotées** sont touchables (une ligne sans annotation ne peut pas être précisée avant le jalon 2). Les annotations posées avant cette version n'ont pas d'empreinte : relancer « Corriger ».
  **Correctif après le 1er essai iPad (l'utilisateur ne pouvait pas répondre aux lectures douteuses)** : (1) les boutons de réponse (Oui/Non ou « Ce n'est pas ce que j'ai écrit ») sont maintenant **directement sous chaque annotation non « ok » de la liste du panneau** (avant : seulement dans le détail ouvert par un appui sur la feuille) ;
  (2) l'appui doigt sur la feuille rejetait les contacts > 60 px (un gros doigt) : seuil aligné sur le rejet de paume (115 px), durée ≤ 700 ms, glissement ≤ 18 px, journal `?debug` (« appui … »). Vérifié en Edge headless avec un contact simulé de 80 px.
- **Chantier 2, jalon 2 FAIT (c), testé sur PC (Edge headless + vrai serveur), PAS sur iPad** : bouton **Discuter** (bulle) dans la barre → panneau avec **fil de messages** (historique par feuille, IndexedDB `conversation`, `src/conversation.ts`, 120 messages max, bouton Effacer),
  champ de message (Scribble iPadOS) + **Envoyer** ; l'historique compact (8 derniers) est renvoyé à chaque message (pas de `--resume`). **Cible** : annotation touchée / ligne choisie dans la liste → puce « À propos de Gx ✕ » ; **Montrer une zone** → panneau réduit (`.discret`), lasso armé,
  les traits entourés (`zone_traits`) donnent un gros plan côté serveur ET désignent les lignes concernées (≥ la moitié des traits du groupe dans la zone, 3 max) → on peut donc parler d'une ligne **sans annotation**. Les précisions (jalon 1) sont aussi inscrites dans le fil.
  La réponse du tuteur = message + annotations créées/remplacées/retirées sur la feuille (essai : question sur la ligne de la somme, entourée au lasso, jamais annotée → réponse « c'est la formule de ∑k, pas de ∑k² » + cercle rouge et note posés sur la feuille).
  Fichiers : `src/conversation.ts`, `src/ui/resultats.ts` (corps/fil/composer), `traits_ids` dans `GroupeLu`, `/discuter` (déduction des cibles par la zone).
- **Chantier 2 (l'élève se fait comprendre) — plan validé, RIEN de codé, on tranche après les résultats de la comparaison** (si le mode image l'emporte, (a) et (b) se simplifient : plus de LaTeX OCR à corriger).
  Décisions : (a) Oui/Non + pastilles dans le **panneau** (pas sur la feuille) ; (b) **rangée de pastilles sous la formule** (pas de symbole touchable dans KaTeX) ; précision liée à l'empreinte du groupe (oubliée si la ligne est réécrite),
  transmise comme `precision_eleve` ; (c) discussion avec **historique compact renvoyé à chaque message, sans `--resume`** (`claude -p --resume <id>` existe mais exige de garder la session et le même cwd), endpoint `/discuter`
  (réponse = schéma d'annotations + `message` + `retirer`), « montrer cette zone » = lasso → PNG joint ; une réponse ne relance que les lignes concernées.
  Plus tard : corrections de lecture (image du groupe → bon LaTeX) stockées dans `bench-reco/corrections_lecture/` (local, à mettre dans `.gitignore`), pour évaluer/affiner TexTeller.
- Test visuel sans iPad : servir `dist/` avec un serveur Python **qui déclare `.js` en text/javascript** (http.server nu → écran gris), injecter IndexedDB
  (`keyval-store` / `keyval`, clés `feuille` et `annotations`) via une page seed, capturer avec Edge `--headless=new --timeout=…` (PAS `--virtual-time-budget` : bloque IndexedDB)
  et retarder l'événement `load` (image lente) sinon les polices KaTeX ne sont pas chargées sur la capture.

## 3. Pièges rencontrés (à ne pas refaire)
- **Outil Bash** : les doubles barres obliques inverses `\\` des heredocs / `node -e` sont réduites en `\`. Pour tout fichier ou motif contenant des
  `\` (regex, LaTeX), utiliser **Write / Edit**, pas un heredoc.
- Python 3.11 : pas de guillemets identiques imbriqués dans une f-string ; chaînes avec `\[` en `r"…"`.
- TOML : clés ASCII uniquement (pas d'accents). Console Windows : encoder en UTF-8 (`sys.stdout.reconfigure(encoding="utf-8")`).
- `rapidocr` doit rester à **3.9.1** (la 3.10 casse `cnocr`/`cnstd`, donc Pix2Text).
- Disque C: presque plein (~8,7 Go libres) ; `bench-reco/.venv` = 2,2 Go ; poids de modèles dans le cache Hugging Face et `%APPDATA%\pix2text`.
- Pour vérifier un rapport HTML visuellement : Edge en mode `--headless=new --screenshot` fonctionne.
- **Arrêter un serveur de test** : cibler par port (`*serveur.py*--port 8797*`, `*_tmp*srv.py*`), JAMAIS `*serveur.py*` seul ni `taskkill python.exe` : cela tuerait le serveur de l'utilisateur (8765) et la prévisualisation (4173).
- **Ne pas supprimer `bench-reco/corrections_lecture/*`** sans regarder : ce sont les précisions réelles de l'élève (les entrées de test ont déjà été retirées).
- Banc de test Edge : un profil neuf par essai, base IndexedDB amorcée dans un run séparé, `load` retardé par une image lente (sinon capture trop tôt = écran gris).
