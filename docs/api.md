# API - HEIG-Échange

Documentation de l'API REST exposée par `src/app.ts`.
Collection Bruno correspondante : `bruno/` , voir `bruno/README.md` .

## Base URL

En local : `http://localhost:3000`

Le domaine public (QR codes, liens de partage/invitation) est configurable via
la variable d'environnement `PUBLIC_BASE_URL` (voir `.env.example`).

### `GET /config`

Config publique consommee par le frontend.

- `200` → `{ publicBaseUrl }`

## Authentification - `/auth`

L'authentification actuelle est **email + mot de passe** (bcrypt), via
`express-session` : un cookie de session (`connect.sid`) est posé au
register/login et doit être renvoyé à chaque requête protégée. 

### `POST /auth/register`

Crée un compte et ouvre la session.

| Champ | Type | Requis | Contrainte |
|---|---|---|---|
| `email` | string | oui | domaine `heig-vd.ch` ou `hes-so.ch` |
| `displayName` | string | oui | non vide |
| `password` | string | oui | 8 caractères minimum |

- `201` → `{ id, email, displayName, role: "user" }`
- `400` - champs manquants/invalides
- `403` - domaine d'email non autorisé
- `409` - un compte existe déjà pour cet email

Les comptes admin doivent être crée en base de données.

### `POST /auth/login`

| Champ | Type | Requis |
|---|---|---|
| `email` | string | oui |
| `password` | string | oui |

- `200` → `{ id, email, displayName, role }`
- `400` - champs manquants
- `401` - mot de passe incorrect
- `403` - compte bloqué (`is_blocked`)
- `404` - aucun compte pour cet email

### `POST /auth/logout`

Détruit la session serveur et le cookie.

- `500` - la session n'a pas pu être détruite côté serveur.

### `GET /auth/me`

Renvoi le ompte lié à la session en cours.

- `200` → `{ id, email, displayName, avatarUrl, role }`
- `401` - pas connecté, ou compte bloqué


### `PATCH /auth/me` - connecté

Modifie le profil. Mise à jour partielle : n'envoyer que les champs à changer.

| Champ | Type | Requis |
|---|---|---|
| `displayName` | string | non |
| `avatarUrl` | string \| null | non |
| `password` | string | non - 8 caractères minimum, même règle que `POST /auth/register` |
| `currentPassword` | string | **oui si `password` est fourni** |

- `200` → `{ id, email, displayName, avatarUrl, role }`
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

- `201` → `{ id, ownerId, categoryId, title, description, itemCondition, location, status: "available" }`
- `400` - champs manquants/invalides, ou `categoryId` inexistant
- `401` - pas connecté

### `PATCH /listings/:id` - connecté, propriétaire ou admin

Mise à jour partielle : mêmes champs que la création (`categoryId`,
`title`, `description`, `itemCondition`, `location`), tous optionnels mais au
moins un requis. `location` accepte `null` pour effacer le lieu.

- `200` → l'annonce mise à jour (même forme que `GET /listings/:id` sans le
  tableau `photos`)
- `400` - aucun champ fourni, champ invalide, ou `categoryId` inexistant
- `401` - pas connecté
- `403` - ni propriétaire ni admin
- `404` - annonce introuvable (ou déjà supprimée)

### `GET /listings`

Grille des annonces. **Accessible sans être connecté.** Filtres optionnels,
combinables :

| Query param | Type | Effet |
|---|---|---|
| `categoryId` | number | filtre par catégorie |
| `ownerId` | number | filtre par propriétaire (utilisé pour "mes objets" sur le profil) |
| `q` | string | recherche plein texte (`title` + `description`, FULLTEXT MariaDB) |

- `200` → tableau d'annonces, `photoUrl` = première photo (vignette) ou
  `null`, `location` (lieu libre ou `null`), triées par date de création
  décroissante
- `400` - `categoryId`/`ownerId` fourni mais non numérique

> **Confidentialité des contacts.** `ownerName` et `ownerEmail` ne sont
> renseignés que si la requête provient d'un utilisateur **connecté**. Pour un
> visiteur anonyme, ces deux champs valent `null` (l'annonce reste visible, mais
> pas les informations de contact du donneur).

### `GET /listings/:id`

Fiche détail, avec le tableau complet des photos. **Accessible sans être
connecté** (mêmes règles de masquage `ownerName`/`ownerEmail` que ci-dessus).

- `200` → annonce (+ `location`, `ownerEmail`) + `photos: [{ id, url, position }]`
- `400` - id non numérique
- `404` - annonce introuvable

### `POST /listings/:id/photos` - connecté, propriétaire ou admin

Ajoute une photo à une annonce. Corps **multipart/form-data**, champ `photo`
(image jpeg/png/webp/gif, 5 Mo max). Le fichier est stocké sur disque (volume
Docker `uploads-data`) et servi via `/uploads/...`.

- `201` → `{ id, url, position }`
- `400` - fichier manquant/invalide, id non numérique, image trop volumineuse
- `401` - pas connecté
- `403` - ni propriétaire ni admin
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
- `404` - utilisateur introuvable (ou supprimé/bloqué)

### `GET /users/:id/qr`

QR code (SVG) pointant vers le profil public (`PUBLIC_BASE_URL/u.html?id=:id`).
Le domaine encodé provient de la variable d'environnement `PUBLIC_BASE_URL`.

- `200` → image `image/svg+xml`
- `400` - id non numérique
- `404` - utilisateur introuvable (ou supprimé/bloqué)

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

---

