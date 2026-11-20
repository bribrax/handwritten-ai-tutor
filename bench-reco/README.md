# bench-reco — banc de test de reconnaissance d'écriture manuscrite mathématique

Mesure si Pix2Text (formules seules) et TexTeller lisent correctement des maths écrites au stylet dans l'app.
Pas d'intégration dans l'app : on lit un JSON exporté et on produit un rapport HTML.

## Installation (Windows, CPU uniquement)

```powershell
cd bench-reco
py -3.11 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt     # ≈ 2,2 Go dans .venv
```

`requirements.txt` fige les versions directes ; `requirements-lock.txt` est le gel complet (`pip freeze`).
Python 3.11 : testé ; `texteller` exige ≥ 3.10.
Premier lancement : téléchargement des poids (≈ 120 Mo Pix2Text, ≈ 1,2 Go TexTeller), **non compté** dans les temps.

## Utilisation

```powershell
.venv\Scripts\python bench.py feuille.json                           # lecture seule
.venv\Scripts\python bench.py feuille.json --verite verite.json      # avec scores
.venv\Scripts\python bench.py feuille.json --sans-reco               # regroupement + rendu seulement (rapide)
```

Options : `--modeles pix2text,texteller`, `--hauteurs 128,256`, `--config autre.toml`, `--sortie dossier`.
Sortie : `sorties/<feuille>/rapport.html` (images intégrées ; l'aperçu LaTeX charge KaTeX depuis un CDN, donc en ligne) et `resultats.json`.

### Méthode conseillée

1. Exporter la feuille depuis l'app (réglages → « Exporter le JSON »).
2. `--sans-reco` : regarder l'aperçu en haut du rapport. Chaque cadre = un groupe `G1`, `G2`… (de haut en bas, puis de gauche à droite). Si une fraction, un exposant ou une borne est coupé, ajuster `config.toml` et recommencer.
3. Écrire `verite.json` avec le LaTeX attendu pour chaque groupe :
   ```json
   { "G1": "f'(x)=3x^2+1", "G2": "\\frac{x+1}{2}=3" }
   ```
   (les clés sont les identifiants du rapport ; un groupe sans entrée est lu mais pas noté ; `{ "G1": { "latex": "…" } }` est aussi accepté).
4. Relancer sans `--sans-reco`.

## Ce que fait le script

**Chargement.** Seuls les traits `outil == "stylo"` sont gardés (les traits effacés ne sont pas dans l'export). Couleur ignorée.

**Échelle.** `h` = hauteur typique d'un caractère, estimée (centile des hauteurs de traits « normaux », sans barres ni points). **Tous les seuils de `config.toml` sont des multiples de `h`** (sauf les durées, en secondes).

**Regroupement** (`benchreco/groupement.py`) — d'abord les *structures*, puis les lignes :
1. morceaux d'un même caractère et caractères collés (boîtes à moins de 0,35 h) ;
2. inclusion (racine carrée, grandes parenthèses) ;
3. **fractions** : une barre horizontale avec au moins un trait au-dessus *et* un au-dessous dans son empan est une barre de fraction ; tout le contenu est soudé à la barre (fractions imbriquées comprises). Un signe `=` n'est pas pris pour une fraction ;
4. **grands symboles** (∑ ∏ ∫…, hauteur ≥ 1,5 h) : on absorbe les petits traits dans leur aplomb (bornes) ou à leur droite, s'ils sont proches dans l'espace ou dans le temps ;
5. **lignes** : recouvrement vertical des « bandes de ligne » (une fraction occupe la bande de sa barre, pas toute sa hauteur, pour ne pas fusionner avec les lignes voisines) ; **exposants et indices** reliés par une règle plus souple qui exige en plus la proximité temporelle.

**Rendu** (`benchreco/rendu.py`) : noir sur blanc, bouts ronds, anticrénelage (dessin à 4× puis réduction), marge 0,5 h, épaisseur proportionnelle à `h`. L'image a exactement la hauteur demandée ; plusieurs hauteurs sont testées (`[128, 256]` par défaut).

**Mesures** : chargement des poids et import Python séparés (téléchargement exclu) ; une lecture de préchauffage jetée ; puis temps de chaque lecture.

**Scores** (`benchreco/metriques.py`) : après normalisation du LaTeX (`\dfrac`=`\frac`, `\left`/`\right`, espaces, accolades inutiles, délimiteurs `\[ \]`…), « exact », CER (caractères) et TER (symboles LaTeX). Le CER n'est pas borné par 100 % : lire la **médiane** autant que la moyenne.

## Limites à connaître avant d'interpréter les résultats

- **La hauteur d'image compte peu.** Les deux modèles ramènent l'image dans un carré fixe (TexTeller : rognage des bords blancs, grand côté ramené à 448 px, remplissage). Ce qui joue, c'est le **rapport largeur/hauteur** : une longue ligne est fortement réduite. Le rapport signale les images très allongées (> 14:1). Le banc ne coupe pas une ligne trop longue.
- **La confiance de Pix2Text n'indique pas les erreurs** : elle reste à 96–100 % sur des lectures fausses. Ne pas s'en servir pour trier.
- TexTeller ne fournit pas de score de confiance.
- Les exemples de `samples/` sont **synthétiques** (traits réguliers générés, `python samples/synth.py`). Ils servent à tester le regroupement et la chaîne, **pas** à juger la précision sur de la vraie écriture.
- Les tests (`python -m pytest tests`) vérifient que fractions, exposants, sommes, intégrales et lignes serrées ne sont pas coupés ou fusionnés ; ils ont été vérifiés en cassant volontairement les seuils (3 des 5 cas deviennent rouges ; exposants et sommes sont peu discriminants sur ces exemples serrés).
- Tous les temps sont mesurés sur CPU (Ryzen 5 5600H, 6 cœurs), une lecture à la fois.

## Licences (code ET poids) — vérifié le 28/10/2026

Sources : API Hugging Face (métadonnées des dépôts), API GitHub, PyPI, métadonnées des paquets installés. Ce n'est pas un avis juridique : à faire valider avant un produit.

| Élément | Licence | Remarques |
|---|---|---|
| Pix2Text — code | MIT | |
| Pix2Text — poids `breezedeus/pix2text-mfr`, `…-mfr-1.5` | MIT (fiches HF) | Jeu d'entraînement **non documenté** sur les fiches. |
| Pix2Text — autres modèles | **payants** | Variantes PyTorch, `mfr-pro`, `mfr-plus` : listées comme `PAID_MODELS` dans le paquet, inaccessibles ici. Seuls `mfr` et `mfr-1.5` en ONNX sont gratuits. |
| TexTeller — code | Apache-2.0 | |
| TexTeller — poids `OleehyO/TexTeller` | Apache-2.0 (fiche HF) | |
| TexTeller — données d'entraînement `OleehyO/latex-formulas` | **OpenRAIL** | Licence d'usage avec restrictions de comportement : à lire. La fiche mentionne aussi un entraînement 2.0 sur 7,5 M d'exemples dont la provenance n'est pas détaillée. |

**Piège pour un produit — dépendances de `pip install pix2text`.** Sur 164 paquets installés, 5 sont sous **AGPL-3.0** et 1 sous GPL :
`doclayout-yolo`, `ultralytics` (+ `ultralytics-platform`, `ultralytics-thop`), `pymupdf` (double licence AGPL / commerciale) — et `Unidecode` (GPL v2+).
Tous arrivent via Pix2Text (`pix2text` → `doclayout-yolo`, `pymupdf` ; `cnstd` → `ultralytics`, `Unidecode`).
**Même en n'utilisant que le modèle de formules, l'import `pix2text.latex_ocr` charge réellement `ultralytics`, `pymupdf` et `Unidecode`** (vérifié ; import de 8 s).
À l'inverse, `import texteller` seul ne charge aucun de ces paquets (vérifié), et le paquet `texteller` n'en dépend pas.
Pour un produit avec Pix2Text, il faudrait n'utiliser que les poids ONNX MIT avec un code d'inférence à soi (onnxruntime + tokenizer), sans installer le paquet.

## Fichiers

```
bench.py              point d'entrée
config.toml           tous les seuils (relatifs à h)
benchreco/            feuille · groupement · rendu · reco · metriques · rapport
samples/synth.py      générateur de feuilles synthétiques (+ exemple.json, exemple_verite.json)
tests/                regroupement et métriques
```

Dépendance épinglée à connaître : `rapidocr==3.9.1` (la 3.10 supprime une fonction importée par `cnocr`/`cnstd`).
