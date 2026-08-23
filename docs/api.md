# API - HEIG-Échange

Documentation de l'API REST exposée par `src/app.ts`.
Collection Bruno correspondante : `bruno/` , voir `bruno/README.md` .

## Base URL

En local : `http://localhost:3000`

Le domaine public est configurable via la variable d'environnement
`PUBLIC_BASE_URL` (voir `.env.example`). Il alimente **tout lien destiné à
sortir de l'application** : QR codes (profil et annonce), `shareUrl` des
annonces, URL absolues des images, liens contenus dans les emails, lien
d'invitation. L'API n'utilise jamais l'hôte de la requête à la place — un lien
partagé doit rester valable hors du navigateur qui l'a produit. **En
staging/prod, cette variable doit impérativement pointer sur le vrai domaine.**

### `GET /config`

Config publique consommée par le frontend : lui évite de dupliquer des valeurs
qui vivent côté serveur.

- `200` → `{ publicBaseUrl, maxPhotosPerListing, reverificationIntervalDays }`

## Authentification - `/auth`

L'authentification actuelle est **email + mot de passe** (bcrypt), via
`express-session` : un cookie de session (`connect.sid`) est posé au
login et doit être renvoyé à chaque requête protégée.

Un compte fraîchement créé n'est **pas** utilisable immédiatement : l'adresse
email doit d'abord être vérifiée par un code reçu par email (voir
`POST /auth/verify-email` ci-dessous). `POST /auth/login` refuse la connexion
tant que ce n'est pas fait.

### Reconfirmation tous les 6 mois

Une confirmation d'adresse **ne vaut que 180 jours**. Passé ce délai le compte
est *suspendu* :

- `POST /auth/login` répond `403` avec `code: "EMAIL_REVERIFICATION_REQUIRED"`
  et envoie immédiatement un nouveau code ;
- une session déjà ouverte est coupée : `GET /auth/me` et toute route protégée
  répondent `403` avec le même code ;
- **ses annonces disparaissent des listes publiques** (`GET /listings`,
  `GET /listings/:id`, QR de l'annonce) et son profil public renvoie `404`.

Rien n'est supprimé : tout réapparaît dès que l'adresse est reconfirmée via
`POST /auth/verify-email`.

Toutes les réponses décrivant le compte connecté (`register`, `login`,
`verify-email`, `GET /auth/me`, `PATCH /auth/me`) portent le même bloc d'état :

| Champ | Type | Sens |
|---|---|---|
| `emailVerified` | boolean | l'adresse a déjà été confirmée au moins une fois |
| `emailStatus` | `unverified` \| `verified` \| `expiring` \| `expired` | état courant |
| `emailVerifiedAt` | string \| null | date de la dernière confirmation |
| `emailExpiresAt` | string \| null | date de péremption de cette confirmation |
| `daysUntilEmailExpiry` | number \| null | jours restants (`0` si périmé) |
| `reverificationIntervalDays` | number | durée de validité (180) |

`expiring` signifie « valable, mais périmé dans moins de 14 jours » : c'est ce
qui déclenche le bandeau d'avertissement dans l'interface et le rappel par
email. Le délai est une constante applicative
(`src/auth/emailVerification.ts`), pas une variable d'environnement.

### `POST /auth/register`

Crée un compte (non vérifié) et envoie un code de vérification par email.**N'ouvre pass la session**

| Champ | Type | Requis | Contrainte |
|---|---|---|---|
| `email` | string | oui | domaine `heig-vd.ch` ou `hes-so.ch` |
| `displayName` | string | oui | non vide |
| `password` | string | oui | 8 caractères minimum |

- `201` → `{ id, email, displayName, role: "user", message, codeTtlMinutes }`
  + bloc d'état email (+ `devVerificationCode` — voir encadré ci-dessous)
- `400` - champs manquants/invalides
- `403` - domaine d'email non autorisé
- `409` - un compte existe déjà pour cet email

Les comptes admin doivent être crée en base de données.

> **`devVerificationCode` (mode test uniquement).** Quand la variable
> d'environnement `EXPOSE_VERIFICATION_CODE_FOR_TESTING` vaut exactement
> `"true"`, la réponse inclut aussi le code de vérification en clair, pour
> pouvoir tester sans accéder à une vraie boîte mail (suite Bruno,
> `scripts/seed_demo_data.py`). `compose.dev.yaml` l'active déjà.
> **Ne jamais l'activer en staging exposé ni en production** : n'importe qui
> pourrait confirmer l'adresse d'un tiers.

### `POST /auth/verify-email`

Confirme l'adresse email avec le code reçu (8 chiffres, valable 15 minutes,
usage unique).

Sert **aussi** à la reconfirmation semestrielle : tant qu'un code est en
attente sur le compte, il est consommé, même si l'adresse avait déjà été
confirmée par le passé.

| Champ | Type | Requis |
|---|---|---|
| `email` | string | oui |
| `code` | string | oui |

- `200` → bloc d'état email + `{ reactivated }` — `reactivated: true` quand le
  compte sortait de suspension (un email de réactivation lui est envoyé)
- `400` - champs manquants, ou code invalide/expiré
- `404` - aucun compte pour cet email
- `409` - rien à confirmer (adresse valide et aucun code en attente)

### `POST /auth/resend-code`

Régénère et renvoie un code de vérification (code perdu, expiré, ou
reconfirmation à faire).

| Champ | Type | Requis |
|---|---|---|
| `email` | string | oui |

- `200` → `{ message, emailStatus, codeTtlMinutes }` (+ `devVerificationCode`
  en mode test, même règle que `POST /auth/register`)
- `400` - `email` manquant
- `404` - aucun compte pour cet email
- `409` - l'adresse est valide et pas encore proche de l'échéance
  (`emailStatus: "verified"`) : il n'y a rien à reconfirmer

### `POST /auth/login`

| Champ | Type | Requis |
|---|---|---|
| `email` | string | oui |
| `password` | string | oui |

- `200` → `{ id, email, displayName, role }` + bloc d'état email
- `400` - champs manquants
- `401` - mot de passe incorrect
- `403` - l'un des trois cas suivants :
  - `code: "EMAIL_NOT_VERIFIED"` — inscription jamais confirmée ;
  - `code: "EMAIL_REVERIFICATION_REQUIRED"` — confirmation vieille de plus de
    6 mois. Un nouveau code est envoyé dans la foulée, la réponse porte aussi
    `email` (et `devVerificationCode` en mode test) ;
  - compte bloqué par un admin (`is_blocked`).
- `404` - aucun compte pour cet email

### `POST /auth/logout`

Détruit la session serveur et le cookie.

- `500` - la session n'a pas pu être détruite côté serveur.

### `GET /auth/me`

Renvoi le ompte lié à la session en cours.

- `200` → `{ id, email, displayName, avatarUrl, role }` + bloc d'état email
- `401` - pas connecté, ou compte bloqué
- `403` - compte suspendu, adresse à reconfirmer
  (`code: "EMAIL_REVERIFICATION_REQUIRED"`) : la session reste ouverte mais
  l'accès est coupé jusqu'à la reconfirmation


### `PATCH /auth/me` - connecté

Modifie le profil. Mise à jour partielle : n'envoyer que les champs à changer.

| Champ | Type | Requis |
|---|---|---|
| `displayName` | string | non |
| `avatarUrl` | string \| null | non |
| `password` | string | non - 8 caractères minimum, même règle que `POST /auth/register` |
| `currentPassword` | string | **oui si `password` est fourni** |

- `200` → `{ id, email, displayName, avatarUrl, role }` + bloc d'état email
- `400` - aucun champ fourni, champ invalide (`displayName` vide,
  `avatarUrl` ni string ni null, `password` trop court), ou `password`
  fourni sans `currentPassword`
- `401` - pas connecté, ou `currentPassword` incorrect

> Pas d'endpoint d'upload de fichier pour l'avatar : `avatarUrl` est une chaîne (URL), à héberger ailleurs pour l'instant.

### `DELETE /auth/me` - connecté

Suppression du compte par son propriétaire..
Ferme aussi toutes ses annonces encore actives, puis détruit la session.

- `204`, pas de body
- `401` - pas connecté

---

## Annonces - `/listings`

### `POST /listings` - connecté

Crée une annonce, `owner_id` vient de la session.

| Champ | Type | Requis |
|---|---|---|
| `categoryId` | number | oui |
| `title` | string | oui |
| `description` | string | oui |
| `itemCondition` | `"neuf" \| "tres_bon" \| "bon" \| "usage" \| "a_reparer"` | oui |
| `location` | string \| null | non - lieu libre (texte) |

- `201` → `{ id, ownerId, categoryId, title, description, itemCondition, location, status: "available", photoCount: 0, shareUrl, qrUrl }`
- `400` - champs manquants/invalides, ou `categoryId` inexistant
- `401` - pas connecté
- `403` - compte suspendu (adresse à reconfirmer)

### `PATCH /listings/:id` - connecté, propriétaire ou admin

Modifier une annonce **après publication**. Mise à jour partielle : tous les
champs sont optionnels, mais au moins un est requis.

| Champ | Type | Effet |
|---|---|---|
| `categoryId` | number | change la catégorie |
| `title` | string | non vide |
| `description` | string | non vide |
| `itemCondition` | enum | même liste qu'à la création |
| `location` | string \| null | `null` efface le lieu |
| `status` | `"available" \| "reserved" \| "closed"` | marque l'objet réservé ou donné |

`status` pilote aussi `closed_at` : renseigné au passage en `closed`, remis à
`NULL` si l'annonce est remise en ligne. Une annonce `closed` reste visible
(signalée comme telle) — pour la retirer complètement, utiliser
`DELETE /listings/:id`.

- `200` → l'annonce mise à jour (même forme que `GET /listings/:id` sans le
  tableau `photos`)
- `400` - aucun champ fourni, champ invalide, `status` inconnu, ou
  `categoryId` inexistant
- `401` - pas connecté
- `403` - ni propriétaire ni admin, ou compte suspendu
- `404` - annonce introuvable (ou déjà supprimée)

### `GET /listings`

Grille des annonces. **Accessible sans être connecté.** Filtres optionnels,
combinables :

| Query param | Type | Effet |
|---|---|---|
| `categoryId` | number | filtre par catégorie |
| `ownerId` | number | filtre par propriétaire (utilisé pour "mes objets" sur le profil) |
| `q` | string | recherche plein texte (`title` + `description`, FULLTEXT MariaDB) |

- `200` → tableau d'annonces, triées par date de création décroissante
- `400` - `categoryId`/`ownerId` fourni mais non numérique

Chaque annonce porte, en plus de ses champs métier :

| Champ | Sens |
|---|---|
| `photoUrl` | chemin **relatif** de la vignette (première photo) ou `null` — c'est ce qu'affiche le frontend |
| `photoAbsoluteUrl` | même image en **URL absolue** (`PUBLIC_BASE_URL`), pour un partage, un `og:image`, un email |
| `photoCount` | nombre total de photos — alimente la pastille « +N » des cartes |
| `shareUrl` | URL publique de la fiche, à partager telle quelle |
| `qrUrl` | URL du QR code SVG de l'annonce |

> **Confidentialité des contacts.** `ownerName` et `ownerEmail` ne sont
> renseignés que si la requête provient d'un utilisateur **connecté**. Pour un
> visiteur anonyme, ces deux champs valent `null` (l'annonce reste visible, mais
> pas les informations de contact du donneur).

> **Propriétaires suspendus.** Seules les annonces dont le propriétaire est un
> compte actif sont renvoyées : ni supprimé, ni bloqué, ni suspendu faute
> d'avoir reconfirmé son adresse depuis 6 mois. Les annonces ne sont pas
> supprimées pour autant — elles réapparaissent dès la reconfirmation.

### `GET /listings/:id`

Fiche détail, avec le tableau complet des photos. **Accessible sans être
connecté** (mêmes règles de masquage `ownerName`/`ownerEmail` et de
propriétaire actif que ci-dessus).

- `200` → annonce (mêmes champs que `GET /listings`) +
  `photos: [{ id, url, absoluteUrl, position }]`, ordonnées par `position`
  (la position 0 est la vignette)
- `400` - id non numérique
- `404` - annonce introuvable, ou propriétaire suspendu/bloqué

### `GET /listings/:id/qr`

QR code (SVG) pointant vers la fiche publique de l'annonce
(`PUBLIC_BASE_URL/listing.html?id=:id`). **Accessible sans être connecté.**

- `200` → `image/svg+xml` (`Cache-Control: public, max-age=3600`)
- `400` - id non numérique
- `404` - annonce introuvable, ou propriétaire suspendu/bloqué

### `GET /listings/interested` - connecté

Ids des annonces (encore actives) sur lesquelles l'utilisateur connecté a
manifesté son intérêt.

- `200` → `[listingId, ...]` (tableau de nombres, triés par date d'inscription
  décroissante)
- `401` - pas connecté

### `GET /listings/:id/interest` - connecté

État de l'intérêt du visiteur connecté pour cette annonce.
Renvoi true si l'utilisateur a deja marque son interet pr cet article

- `200` → `{ interested: boolean }`
- `400` - id non numérique
- `401` - pas connecté

### `POST /listings/:id/interest` - connecté

Marquer l'utilisateur comme interessé par l'article

- `201` → `{ interested: true }` (première fois)
- `200` → `{ interested: true }` (déjà enregistré)
- `400` - id non numérique, ou tentative sur sa propre annonce
- `401` - pas connecté
- `404` - annonce introuvable

### `DELETE /listings/:id/interest` - connecté

Enleve l'interet de l'utilisateur

- `204`, pas de body
- `400` - id non numérique
- `401` - pas connecté
- `404` - aucun intérêt enregistré pour cette annonce (par ce compte)

### `POST /listings/:id/photos` - connecté, propriétaire ou admin

Ajoute **une ou plusieurs** photos à une annonce. Corps
**multipart/form-data** ; deux noms de champ sont acceptés :

| Champ | Usage |
|---|---|
| `photos` | plusieurs fichiers dans la même requête — ce qu'envoie le formulaire web |
| `photo` | un seul fichier — forme historique, toujours supportée |

Formats jpeg/png/webp/gif, 5 Mo par fichier, **10 photos maximum par annonce**
(valeur exposée par `GET /config`). Les fichiers sont stockés sur disque
(volume Docker `uploads-data`) et servis via `/uploads/...`. Les positions se
suivent : la photo en position 0 sert de vignette dans la grille.

- `201` → un seul fichier envoyé : `{ id, url, absoluteUrl, position }` (forme
  historique) ; plusieurs fichiers : `{ photos: [{ id, url, absoluteUrl, position }] }`
- `400` - fichier manquant/invalide, id non numérique, image trop volumineuse,
  ou plafond de 10 photos dépassé
- `401` - pas connecté
- `403` - ni propriétaire ni admin, ou compte suspendu
- `404` - annonce introuvable

### `DELETE /listings/:id/photos/:photoId` - connecté, propriétaire ou admin

Retire une photo d'une annonce. Le fichier est effacé du disque (uniquement
s'il vit bien dans `UPLOAD_DIR`) et les positions restantes sont retassées pour
rester contiguës.

- `204`, pas de body
- `400` - id non numérique
- `401` - pas connecté
- `403` - ni propriétaire ni admin, ou compte suspendu
- `404` - annonce ou photo introuvable

### `PATCH /listings/:id/photos` - connecté, propriétaire ou admin

Réordonne le carrousel. La première photo citée devient la vignette.

| Champ | Type | Requis |
|---|---|---|
| `photoIds` | number[] | oui - **exactement une fois chaque photo de l'annonce** |

Un ordre partiel est refusé : il laisserait des positions ambiguës entre les
photos citées et les autres.

- `200` → `{ photos: [{ id, url, absoluteUrl, position }] }`
- `400` - `photoIds` absent, mal formé, ou incomplet
- `401` - pas connecté
- `403` - ni propriétaire ni admin, ou compte suspendu
- `404` - annonce introuvable

### `POST /listings/ai/analyze` - connecté

Envoie une photo (multipart, champ `photo`) à une IA (Claude vision) et renvoie
une pré-saisie pour le formulaire d'annonce. **Ne crée aucune annonce.**

- `200` → `{ categorySlug, categoryId, itemCondition, description }`
- `400` - fichier manquant/invalide
- `401` - pas connecté
- `503` - analyse IA non configurée (`ANTHROPIC_API_KEY` absente)
- `502` - l'appel à l'IA a échoué

### `DELETE /listings/:id` - connecté, propriétaire ou admin

Ferme/retire une annonce (soft delete : `deleted_at`, `status: 'closed'`,
`closed_at`).

| Champ body | Type | Requis |
|---|---|---|
| `reason` | string | **oui, si un admin supprime l'annonce de quelqu'un d'autre** - pas requis si le propriétaire ferme sa propre annonce |

Quand c'est un admin qui supprime (pas le propriétaire), l'action est tracée
dans `moderation_logs` (`action: "delete_listing"`, `details: { reason }`).

- `204`, pas de body
- `400` - id non numérique, ou `reason` manquant pour une suppression admin
- `401` - pas connecté
- `403` - ni propriétaire ni admin
- `404` - annonce introuvable

---

## Catégories - `/categories`

### `GET /categories`

Référence fixe, utilisée pour les filtres et le formulaire de création
d'annonce.

- `200` → `[{ id, slug, label }]`, triées par `label`

---

## Utilisateurs - `/users`

### `GET /users/:id`

Profil **public** d'un utilisateur. Accessible sans être connecté. Ne renvoie
aucune information de contact (email).

- `200` → `{ id, displayName, avatarUrl, createdAt, activeListings, profileUrl }`
- `400` - id non numérique
- `404` - utilisateur introuvable, supprimé, bloqué, ou suspendu (adresse non
  reconfirmée depuis 6 mois)

### `GET /users/:id/qr`

QR code (SVG) pointant vers le profil public (`PUBLIC_BASE_URL/u.html?id=:id`).
Le domaine encodé provient de la variable d'environnement `PUBLIC_BASE_URL`.

- `200` → image `image/svg+xml`
- `400` - id non numérique
- `404` - utilisateur introuvable, supprimé, bloqué, ou suspendu (adresse non
  reconfirmée depuis 6 mois)

---

## Signalements - `/reports`

### `POST /reports` - connecté

Signale une annonce. N'importe quel utilisateur connecté peut signaler ; la
modération se fait ensuite côté admin.

| Champ | Type | Requis |
|---|---|---|
| `listingId` | number | oui |
| `reason` | string | oui |

- `201` → `{ id, listingId, reason, status: "open" }`
- `400` - champs manquants/invalides
- `401` - pas connecté
- `404` - annonce introuvable (ou supprimée)

---

## Administration - `/admin`

Toutes les routes ci-dessous passent par `requireAdmin` : `401` si pas
connecté, `403` si connecté mais `role !== 'admin'`.

### `GET /admin/reports`

File de modération.

| Query param | Type | Effet |
|---|---|---|
| `status` | `"open" \| "reviewed" \| "dismissed"` | filtre par statut |

- `200` → tableau de `{ id, listingId, listingTitle, reporterId, reporterName, reason, status, createdAt, reviewedAt }`, triés par date décroissante
- `400` - `status` invalide

### `PATCH /admin/reports/:id`

Marque un signalement comme traité et trace l'action dans
`moderation_logs` (`action: "review_report"` ou `"dismiss_report"` selon le
statut, ciblant l'annonce concernée).

| Champ | Type | Requis |
|---|---|---|
| `status` | `"reviewed" \| "dismissed"` | oui |
| `note` | string | non - motif de la décision, stocké dans `moderation_logs.details` |

- `204`, pas de body
- `400` - `status` manquant/invalide (`open` refusé ici), `note` non-string
- `404` - signalement introuvable

### `POST /admin/users/:id/block`

Bloque un utilisateur (`is_blocked = true`). Le motif est stocké à la fois
sur `users.blocked_reason` et dans `moderation_logs.details`.

| Champ | Type | Requis |
|---|---|---|
| `reason` | string | oui |

- `204`, pas de body
- `400` - `reason` manquant
- `404` - utilisateur introuvable

### `POST /admin/users/:id/unblock`

Débloque un utilisateur. `reason` optionnel (ex. "signalement infondé après
vérification"), stocké dans `moderation_logs.details` si fourni.

| Champ | Type | Requis |
|---|---|---|
| `reason` | string | non |

- `204`, pas de body
- `404` - utilisateur introuvable

### `GET /admin/moderation-logs`

Historique des actions de modération (`block_user`, `unblock_user`,
`delete_listing`, `review_report`, `dismiss_report`).

| Query param | Type | Effet |
|---|---|---|
| `targetType` | `"user" \| "listing"` | filtre par type de cible |
| `targetId` | number | filtre par id de cible |

- `200` → tableau de `{ id, actorId, actorName, action, targetType, targetId, details, createdAt }`, `details` déjà parsé en JSON (ou `null`), triés par date décroissante
- `400` - `targetType`/`targetId` invalide

### `GET /admin/listings`

Accès aux annonces y compris supprimées (`deleted_at` non filtré) - utile
pour l'historique des publications d'un utilisateur.

| Query param | Type | Effet |
|---|---|---|
| `ownerId` | number | filtre par propriétaire |

- `200` → tableau de `{ id, ownerId, ownerName, title, status, createdAt, closedAt, deletedAt }`, triés par date décroissante
- `400` - `ownerId` invalide

### `GET /admin/suspended-accounts`

Comptes dont l'adresse email n'est pas (ou plus) confirmée, donc suspendus :
connexion refusée et annonces masquées des listes publiques.

- `200` → tableau de
  `{ id, email, displayName, emailStatus, emailVerifiedAt, lastReminderAt, hiddenListings }`
  — `emailStatus` vaut `"unverified"` (jamais confirmé) ou `"expired"`
  (confirmation de plus de 6 mois), `hiddenListings` compte les annonces
  rendues invisibles

### `POST /admin/jobs/email-reverification`

Déclenche à la main le balayage de reverification. Le même balayage tourne
automatiquement une fois par jour (`src/server.ts`) ; cette route sert à le
forcer depuis un cron externe ou pour une démo.

Pour chaque compte concerné, le job pose un nouveau code et envoie soit un
rappel (14 jours avant l'échéance), soit une notification de suspension (une
fois l'échéance passée). Il est idempotent : un second appel dans la foulée ne
renvoie pas les mêmes emails.

- `200` → `{ scanned, reminders, suspensions }`

> **La suspension ne dépend pas de ce job.** Elle se déduit de
> `email_verified_at` à chaque requête, et s'applique donc même si le job n'a
> jamais tourné. Le job se contente de prévenir les utilisateurs par email.

---

