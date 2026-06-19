# Mon Planning — PWA

Application web (PWA) qui lit une photo de planning de travail, repère uniquement
la ligne d'un salarié donné (par défaut **MALICK**), calcule les heures de réveil,
et génère un fichier calendrier `.ics` à ajouter dans Calendrier iPhone.

Tout se passe **dans le navigateur** : l'OCR (Tesseract.js) tourne en local,
aucune photo n'est envoyée à un serveur.

## Fichiers du projet

```
index.html        Interface
style.css          Styles
app.js             Logique : OCR, extraction, calcul des réveils, export .ics
manifest.json      Manifest PWA (installation sur iPhone)
service-worker.js  Cache hors-ligne
icons/             Icônes de l'application
README.md          Ce fichier
```

## 1. Lancer le projet sur Windows

Tesseract.js et le service worker ont besoin d'être servis via **http(s)**, pas
en ouvrant directement le fichier (`file://`). Le plus simple sans Xcode ni
outil compliqué :

**Option A — Python (déjà présent sur beaucoup de PC, sinon installer depuis python.org)**

```bash
cd chemin\vers\planning-pwa
python -m http.server 8000
```

Puis ouvrez `http://localhost:8000` dans Chrome.

**Option B — Extension VS Code "Live Server"**

Ouvrez le dossier dans VS Code, clic droit sur `index.html` → *Open with Live Server*.

**Option C — npx serve**

```bash
cd chemin\vers\planning-pwa
npx serve .
```

## 2. Tester avec Chrome (Windows)

1. Ouvrez `http://localhost:8000`.
2. Cliquez sur **Choisir depuis la galerie** et sélectionnez une photo de planning.
3. Cliquez sur **Analyser la photo** — la première analyse télécharge le modèle
   de langue français de Tesseract (connexion internet nécessaire la première fois).
4. Vérifiez/corrigez les horaires détectés pour **MALICK**.
5. Réglez préparation / trajet / marge — les heures de réveil se calculent automatiquement.
6. Téléchargez le fichier `planning.ics`.

## 3. Déployer sur GitHub Pages

1. Créez un nouveau dépôt GitHub (public).
2. Glissez-déposez **tout le contenu du dossier `planning-pwa`** (pas le dossier
   lui-même, son contenu : `index.html`, `style.css`, `app.js`, etc.) à la racine
   du dépôt.
3. Allez dans **Settings → Pages**.
4. Sous *Build and deployment*, choisissez **Deploy from a branch**, branche
   `main`, dossier `/ (root)`. Enregistrez.
5. GitHub fournit une URL du type `https://votre-utilisateur.github.io/votre-depot/`.
   L'app est utilisable immédiatement, sans build ni configuration supplémentaire.

## 4. Installer sur iPhone (Safari)

L'app doit être accessible via une URL **https** pour fonctionner correctement sur
iPhone (caméra, installation). Deux façons d'y arriver simplement sans Xcode :

- **Déployer gratuitement** sur un hébergeur statique : GitHub Pages, Netlify,
  Vercel, Cloudflare Pages. Glissez-déposez le dossier `planning-pwa` (ou liez-le à
  un dépôt Git) et récupérez l'URL https générée.
- **Ou** servez le dossier depuis votre PC avec un tunnel https
  (par exemple `npx localtunnel --port 8000` ou ngrok) si vous voulez juste tester
  rapidement depuis l'iPhone sur le même réseau.

Une fois l'URL https ouverte dans **Safari** sur iPhone :

1. Appuyez sur le bouton **Partager** (carré avec flèche).
2. Choisissez **Sur l'écran d'accueil**.
3. L'icône "Mon Planning" apparaît sur l'écran d'accueil et s'ouvre en plein écran,
   sans barre Safari.

## 5. Utilisation

1. **Importer mon planning** : prendre une photo ou choisir une image existante.
2. **Analyser la photo** : l'OCR cherche le nom configuré (MALICK par défaut),
   ignore les autres lignes, et extrait les horaires jour par jour (ou REPOS /
   FORMATION).
3. Corriger manuellement si l'OCR s'est trompé sur un horaire (photo floue,
   tableau dense, etc.) — chaque jour reste éditable.
4. Régler temps de préparation, de trajet, et marge de sécurité : l'heure de
   réveil de chaque jour travaillé se met à jour automatiquement.
5. **Télécharger le calendrier .ics**, puis l'ouvrir depuis l'app Fichiers ou
   Mail sur iPhone et choisir **Ajouter à Calendrier**. Chaque événement de
   travail contient une alerte programmée à l'heure de réveil calculée.
6. Le bouton **Vérifier mon planning du jour** donne un résumé immédiat (repos,
   formation, ou horaire + réveil du jour).
7. Le planning, les réglages et l'historique des 5 dernières photos analysées
   sont sauvegardés localement (`localStorage`) — rien n'est perdu en
   refermant l'app.

## 6. Limites connues sur iPhone

- **Pas de vrai réveil natif.** Une PWA ne peut pas créer une alarme dans
  l'app Horloge d'iPhone. La solution fiable proposée ici est l'**alerte
  intégrée à l'événement Calendrier** (`.ics`), qui déclenche une notification
  système même app fermée.
- **Notifications web peu fiables sur iOS.** Safari supporte les notifications
  web depuis iOS 16.4, mais uniquement si l'app a été **installée sur l'écran
  d'accueil**, et elles peuvent être retardées ou ne pas se déclencher si l'app
  n'a pas été ouverte récemment. Utilisez-les comme rappel d'appoint, pas comme
  solution principale.
- **Pas de vérification automatique à 2h du matin.** iOS n'autorise pas une PWA
  à s'exécuter en arrière-plan à une heure précise. Le bouton **Vérifier mon
  planning du jour** et le résumé affiché à l'ouverture remplacent cette
  fonction.
- **Qualité de l'OCR.** La précision dépend de la netteté de la photo et de la
  mise en page du tableau. Un planning bien éclairé, cadré à plat, sans reflet,
  donne les meilleurs résultats. La correction manuelle reste toujours possible.
- **Première analyse plus longue.** Tesseract.js télécharge son modèle de
  langue (~quelques Mo) lors du premier passage ; les analyses suivantes sont
  plus rapides grâce au cache du navigateur.
