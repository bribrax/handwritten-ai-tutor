# Tutorat — la feuille

Canvas d'écriture au stylet (PWA). Vite + TypeScript, perfect-freehand, idb-keyval.

## Commandes

- `npm run dev` — serveur de dev (https://IP:5173), pour l'écriture/les réglages.
- `npm run pwa` — build de production + prévisualisation (https://IP:4173) : **c'est là que le service worker tourne**
  (installation sur l'écran d'accueil, hors-ligne).
- `npm run icons` — régénère les icônes PWA.

## HTTPS de confiance avec mkcert (obligatoire pour le service worker sur l'iPad)

Sur le PC (une fois) :

1. `winget install FiloSottile.mkcert`
2. `mkcert -install` — crée la CA locale et la déclare de confiance sur Windows.
3. Dans ce dossier : `mkcert -cert-file certs/dev.pem -key-file certs/dev-key.pem localhost 127.0.0.1 <IP-du-PC>`
   (IP du PC = celle affichée par `ipconfig`, ex. <IP-du-PC> ; à refaire si elle change).
4. Relancer `npm run dev` : Vite utilise `certs/` automatiquement (sans ce dossier, il retombe sur un certificat auto-signé).

Sur l'iPad (une fois) :

1. Ouvrir `https://<IP>:5173/mkcert-ca.crt` dans Safari → « Autoriser » le téléchargement du profil.
2. Réglages → « Profil téléchargé » → Installer.
3. Réglages → Général → Informations → Réglages des certificats de confiance → activer la CA mkcert.

`mkcert-ca.crt` est la CA **publique** (jamais sa clé privée) et n'est servie qu'en dev.

## Sauvegarde

La feuille est enregistrée automatiquement dans IndexedDB (0,6 s après la dernière modification, et dès que
l'app passe en arrière-plan). Pour que iOS ne purge pas les données, installer l'app sur l'écran d'accueil
(« Partager » → « Sur l'écran d'accueil »).

## Bouton « Corriger » (lecture des formules par TexTeller)

Le bouton envoie la feuille à un petit serveur local sur le PC (`bench-reco/serveur.py`), qui regroupe les traits en lignes,
les rend en images et les fait lire par TexTeller (CPU, ~2 s par ligne). Le résultat s'affiche dans un panneau en bas
(formule rendue + LaTeX) ; toucher une ligne l'entoure sur la feuille. Modifier la feuille ferme le panneau.

1. Sur le PC : `npm.cmd run reco` (charge TexTeller ~10 s ; HTTPS avec `certs/`, port 8765).
2. Sur l'iPad : ouvrir l'app comme d'habitude, écrire, toucher **Corriger**.

L'app appelle `https://<même hôte que l'app>:8765` ; `?reco=https://hôte:port` dans l'URL de l'app pour changer.
Pare-feu Windows : autoriser le port TCP 8765 en entrée (comme pour Vite). Seul TexTeller est utilisé (licence Apache-2.0, aucun paquet AGPL).
