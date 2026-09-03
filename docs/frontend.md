# Frontend

Le frontend est en HTML/JS/CSS.
Les fichiers sont situés dans le dossier `public/`, qui est servi tels quels (fichiers statics) par le serveur web.

## Organisation des fichiers

```
public/
├── css/app.css              système de design + shell responsive
├── js/
│   ├── tailwind-setup.js    config Tailwind partagée (couleurs, police)
│   ├── api.js               client fetch, session, liens de partage, libellés
│   ├── ui.js                navigation, cartes d'annonce, bascule d'affichage, partage
│   ├── listing-form.js      formulaire d'annonce (création ET édition)
│   └── pages/               un module par page
├── index.html               grille des annonces
├── listing.html             fiche détail
├── add-listing.html         publication
├── edit-listing.html        modification d'une annonce publiée
├── verify.html              saisie du code (inscription et reconfirmation)
├── login.html / register.html
├── profile.html             mon profil + mes objets
├── u.html                   profil public d'un autre membre
└── priority-friends.html    groupes prioritaires (aperçu local)
```

Les briques communes (navigation, cartes, partage) vivent dans `ui.js` : chaque
page pose des conteneurs vides et ce module les remplit. C'est ce qui évite que
la navigation diverge d'une page à l'autre.

Les deux barres de navigation existent toujours dans le DOM ; seule leur
propriété `display` change. Redimensionner la fenêtre ne provoque donc aucun
saut ni rechargement.

Le contenu est borné à `80rem` et centré (`.app-container`) : sans cela, les
lignes de texte s'étireraient sur toute la largeur d'un grand écran.

## Densité d'affichage : grille ou compact

À partir de la tablette, un sélecteur permet de choisir entre :

- **Grille** — grandes photos, la vue par défaut, celle de la maquette ;
- **Compact** — une ligne par annonce avec vignette à gauche, pour balayer
  beaucoup d'annonces d'un coup d'œil. Sur très grand écran (`≥ 1280px`), ces
  lignes se répartissent elles-mêmes sur deux colonnes.

Le choix est mémorisé dans `localStorage`
(`heig-echange:view-mode`) et s'applique à l'accueil, à « mes objets » et aux
profils publics. Le sélecteur est masqué sous 768 px : il n'y a alors de la
place que pour une colonne, le proposer n'aurait pas de sens.

## Liens de partage

Aucun lien destiné à sortir du navigateur n'est construit à partir de
`window.location`. Le frontend lit `publicBaseUrl` via `GET /config`, et les
annonces portent déjà `shareUrl`, `qrUrl` et `photoAbsoluteUrl` calculés par
l'API à partir de `PUBLIC_BASE_URL`.

C'est ce qui garantit qu'un QR code scanné, un lien copié ou un email envoyé
depuis une machine de développement ne renvoie pas vers `localhost:3000`.

Le bouton de partage d'une annonce utilise le partage natif du système quand il
existe (`navigator.share`, typiquement sur mobile) et retombe sinon sur un
petit menu : copier le lien, envoyer par email, copier le lien de la photo,
afficher le QR code.

## Photos

Le formulaire accepte plusieurs photos, sélectionnables en une ou plusieurs
fois, avec vignettes et retrait individuel avant envoi. En édition, les photos
déjà en ligne sont affichées à part et supprimables une à une
(`DELETE /listings/:id/photos/:photoId`). La première de la liste est signalée
comme vignette de l'annonce.

Le plafond (10) n'est pas codé en dur côté client : il vient de
`maxPhotosPerListing` dans `GET /config`.

## État du compte

`requireUser()` (dans `api.js`) redirige vers `login.html` si la session est
absente, et vers `verify.html` si l'API répond
`code: "EMAIL_REVERIFICATION_REQUIRED"` — le compte existe mais son adresse a
plus de 6 mois.

Quand l'échéance approche (`emailStatus: "expiring"`), `renderEmailBanner()`
affiche un bandeau d'avertissement en haut de l'accueil et du profil, avec un
lien direct vers la reconfirmation.

## Limites connues

- **Pas de tests automatisés côté frontend.** Il n'y a ni bundler ni
  environnement DOM dans la CI ; la logique testable a donc été poussée côté
  serveur (liens de partage, statuts email, règles de visibilité), où elle est
  couverte par Vitest. Les pages elles-mêmes ont été vérifiées manuellement aux
  trois paliers.
- **Tailwind par CDN** génère les classes à l'exécution : pratique en projet
  d'école, à remplacer par une build CSS si le projet devait aller en
  production sérieuse (poids, absence de purge, dépendance à un CDN externe).
- La page « amis prioritaires » reste un aperçu local (`localStorage`) : aucune
  table ni endpoint ne la porte encore côté serveur.
