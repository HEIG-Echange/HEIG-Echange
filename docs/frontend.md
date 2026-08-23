# Frontend

L'application web servie par Express depuis `public/`. Pas de framework, pas de
bundler : des pages HTML statiques et des modules ES chargés tels quels
(`<script type="module">`). Tailwind arrive par CDN, la configuration commune
est dans `public/js/tailwind-setup.js`.

Ce choix est assumé : il n'y a aucune étape de build côté client, ce qui
maintient le pipeline simple et permet à `compose.dev.yaml` de monter `public/`
en lecture seule pour un rechargement immédiat.

## Organisation des fichiers

```
public/
├── css/app.css              système de design + shell responsive
├── js/
│   ├── tailwind-setup.js    config Tailwind partagée (couleurs, police)
│   ├── api.js               client fetch, session, liens de partage, libellés
│   ├── ui.js                navigation, cartes d'annonce, bascule d'affichage, partage
│   ├── listing-form.js      formulaire d'annonce (création ET édition)
│   ├── photo-picker.js      choix, contrôle et envoi des photos d'une annonce
│   └── pages/               un module par page
├── index.html               grille des annonces
├── listing.html             fiche détail
├── add-listing.html         publication
├── edit-listing.html        modification d'une annonce publiée
├── verify.html              saisie du code (inscription et reconfirmation)
├── login.html / register.html
├── profile.html             mon profil + mes objets
├── u.html                   profil public d'un autre membre
└── admin-ai.html            réglages IA (réservé aux administrateurs)
```

Les briques communes (navigation, cartes, partage) vivent dans `ui.js` : chaque
page pose des conteneurs vides et ce module les remplit. C'est ce qui évite que
la navigation diverge d'une page à l'autre.

## Paliers responsive

Le HTML est identique à toutes les tailles ; c'est `css/app.css` qui déplace la
navigation. Les trois paliers reprennent la maquette Figma :

| Largeur | Navigation | Contenu |
|---|---|---|
| `< 768px` — mobile | barre du bas + bouton « + » flottant | une colonne, en-tête compact avec recherche |
| `≥ 768px` — tablette | barre latérale **en icônes** (72 px) | 2 colonnes, recherche dans la barre du haut |
| `≥ 1024px` — desktop | barre latérale **déployée** (240 px) | 3 colonnes, fiche détail sur 2 colonnes |
| `≥ 1440px` | idem | 4 colonnes |

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

Toute la gestion des photos vit dans `js/photo-picker.js`, partagé par la
création et l'édition. Le module tient deux listes séparées :

- les photos **déjà en ligne** (mode édition) — chaque action part
  immédiatement vers l'API : suppression
  (`DELETE /listings/:id/photos/:photoId`), réordonnancement
  (`PATCH /listings/:id/photos`, qui attend l'ordre complet) ;
- les fichiers **en attente**, choisis dans le navigateur. Ils ne partent qu'à
  l'enregistrement : à la création, l'annonce n'a pas encore d'id avant le
  `POST /listings`.

La zone d'ajout est cliquable, focalisable au clavier et accepte le
glisser-déposer. La première photo de la liste est signalée comme vignette de
l'annonce, et les flèches de chaque vignette permettent de la choisir sans tout
re-téléverser.

Aucune limite n'est codée en dur côté client : nombre maximum de photos, taille
maximale d'un fichier et types MIME acceptés viennent tous de `GET /config`,
qui les publie à partir des constantes réellement appliquées par l'upload. Un
fichier hors limites (HEIC d'iPhone, photo de 8 Mo) est donc refusé **au moment
où l'utilisateur le choisit**, avec un message qui nomme le fichier — et non
par un `400` après la publication de l'annonce.

Les envois sont séquentiels, un fichier par requête : l'ordre des positions est
celui affiché à l'écran, un fichier refusé ne fait pas perdre les autres, et le
bouton affiche l'avancement (« Envoi des photos 2/3… »). À la création, si
l'envoi des photos échoue alors que l'annonce est déjà créée, un nouveau clic
sur « Publier » reprend à l'envoi au lieu de créer un doublon.

## Contacter le donneur

La fiche d'une annonce propose deux boutons à un visiteur connecté :

- **Contacter via Teams** — lien profond
  `https://teams.microsoft.com/l/chat/0/0?users=<email>&message=<texte>`, qui
  ouvre une conversation avec le donneur, message pré-rempli. Teams n'expose
  pas de nom d'utilisateur public : l'adresse e-mail est l'identifiant du lien,
  et comme tout le monde est sur le même annuaire (`@heig-vd.ch` /
  `@hes-so.ch`), Teams retrouve la personne. Si le client lourd est installé,
  c'est lui qui prend la main, sinon Teams web.
- **Contacter par mail** — `mailto:` en secours, pour qui n'utilise pas Teams.

Les deux messages contiennent le lien public de l'annonce (`PUBLIC_BASE_URL`),
pas l'URL du navigateur. À un visiteur non connecté, l'API ne renvoie pas
`ownerEmail` : aucun des deux boutons n'apparaît, seule une invitation à se
connecter.

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
