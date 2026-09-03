-- ---------------------------------------------------------------------------
-- HEIG-Echange — schema de la base de donnees, version 2
--
-- Remplace db/archive/01-schema-v1.sql (conserve pour reference / comparaison
-- avec l'export de production db/production/old-db.sql). La v1 avait diverge
-- du code : les groupes d'amis, les annonces prioritaires et les notifications
-- vivaient uniquement dans des migrations (ou nulle part), si bien qu'une base
-- creee a partir de l'init cassait la moitie des routes de l'API.
--
-- Ce fichier est execute par MariaDB UNE SEULE FOIS, au premier demarrage du
-- conteneur (volume de donnees vide). Il ne rejoue pas sur un volume existant :
-- pour faire evoluer le schema d'une base deja peuplee, ecrire une migration
-- versionnee (db/migrations/), ne pas modifier ce fichier en esperant qu'il se
-- rejoue. Pour passer une base v1 en v2 : db/migrations/006-schema-v2.sql.
--
-- Le nom de la base (MARIADB_DATABASE) est deja selectionne par l'entrypoint :
-- inutile d'ajouter un USE ici.
--
-- Couverture des exigences (voir docs/base-de-donnees.md) :
--   0 Connexion (domaine hes-so.ch / heig-vd.ch) -> users + CHECK email
--   1 Grille d'annonces                          -> listings + listing_photos
--   2 Recherche & filtres                        -> FULLTEXT + index categorie
--   3 Gestion annonces                           -> listings (CRUD)
--   4 Fiche detail (carrousel)                   -> listing_photos (position)
--   5 Contact                                    -> messages
--   6 Fermer une annonce                         -> listings.status / closed_at
--   7 Profil utilisateur                         -> users + avatar_url
--   8 Suppression profil                         -> users.deleted_at (soft delete)
--   9 Roles & moderation                         -> users.role / is_blocked,
--                                                    reports, moderation_logs
--  10 Favoris ("interesse")                      -> listing_interests
--  11 Groupes d'amis / annonces prioritaires     -> friends_groups,
--                                                    friends_group_members,
--                                                    priority_groups,
--                                                    listings.is_priority
--  12 Notifications                              -> notifications
--  13 Reglages admin (prompts IA)                -> app_settings
--
-- Ordre de suppression des tables (dependances FK) : db/cleanup/drop-table-order.sql
-- ---------------------------------------------------------------------------
SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ---------------------------------------------------------------------------
-- users — comptes etudiants et administrateurs
--
-- Le CHECK sur le domaine est une seconde barriere ; la validation applicative
-- reste la reference (elle gere aussi la casse, les alias, etc.).
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email          VARCHAR(255)    NOT NULL,
  display_name   VARCHAR(120)    NOT NULL,
  avatar_url     VARCHAR(512)        NULL DEFAULT NULL,
  password_hash  VARCHAR(255)    NOT NULL,                    -- hash bcrypt, jamais en clair
  email_verified_at TIMESTAMP        NULL DEFAULT NULL,        -- confirmation par code recu par email
  verification_code VARCHAR(8)       NULL DEFAULT NULL,
  verification_code_expires_at TIMESTAMP NULL DEFAULT NULL,
  -- Rappel "votre adresse expire bientot" deja envoye : evite un email par
  -- jour tant que l utilisateur n a pas reconfirme (voir src/jobs/).
  reverification_reminder_sent_at TIMESTAMP NULL DEFAULT NULL,
  role           ENUM('user','admin') NOT NULL DEFAULT 'user',
  is_blocked     BOOLEAN         NOT NULL DEFAULT FALSE,     -- req 9 : blocage
  blocked_reason VARCHAR(255)        NULL DEFAULT NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP,
  deleted_at     TIMESTAMP           NULL DEFAULT NULL,       -- req 8 : soft delete
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role (role),
  -- La confirmation d email ne vaut que 6 mois : colonne filtree a chaque
  -- listing d annonces et balayee par le job de relance.
  KEY idx_users_email_verified (email_verified_at),
  -- Accepte le domaine racine et ses sous-domaines (ex. @edu.hes-so.ch).
  CONSTRAINT chk_users_email_domain CHECK (
    email LIKE '%@hes-so.ch'  OR email LIKE '%.hes-so.ch'  OR
    email LIKE '%@heig-vd.ch' OR email LIKE '%.heig-vd.ch'
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- categories — reference fixe pour le filtrage (req 2)
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
  id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug  VARCHAR(60)  NOT NULL,     -- identifiant stable, utilise en URL/API
  label VARCHAR(120) NOT NULL,     -- libelle affiche
  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- friends_groups — un groupe d'amis, cree et possede par un utilisateur
--
-- Declaree avant listings/priority_groups : une annonce peut etre reservee en
-- avant-premiere aux membres de certains groupes (voir priority_groups).
-- ---------------------------------------------------------------------------
CREATE TABLE friends_groups (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(120)    NOT NULL,
  owner_id   BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                              ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP           NULL DEFAULT NULL,   -- soft delete, comme users/listings
  PRIMARY KEY (id),
  KEY idx_friends_groups_owner (owner_id),
  CONSTRAINT fk_friends_groups_owner
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- friends_group_members — appartenance a un groupe d'amis
--
-- UNIQUE (groupe, membre) : "ajouter un membre" est idempotent, pas de doublon.
-- ---------------------------------------------------------------------------
CREATE TABLE friends_group_members (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  friends_group_id BIGINT UNSIGNED NOT NULL,
  user_id          BIGINT UNSIGNED NOT NULL,
  added_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_group_members_group_user (friends_group_id, user_id),
  KEY idx_group_members_user (user_id),
  CONSTRAINT fk_group_members_group
    FOREIGN KEY (friends_group_id) REFERENCES friends_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_group_members_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- listings — les annonces (req 1, 3, 6)
--
-- "condition" est un mot reserve SQL : la colonne s'appelle item_condition.
-- L'index FULLTEXT alimente la recherche en temps reel (req 2).
--
-- is_priority / end_priority_at : fenetre pendant laquelle l'annonce n'est
-- visible que par le proprietaire, les admins et les membres des groupes
-- listes dans priority_groups. Passee end_priority_at, l'annonce redevient
-- publique sans intervention (aucun job a lancer) — c'est pourquoi la
-- restriction se lit toujours "is_priority = 1 ET end_priority_at > NOW()".
-- ---------------------------------------------------------------------------
CREATE TABLE listings (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_id       BIGINT UNSIGNED NOT NULL,               -- req 1 : proprietaire
  category_id    INT UNSIGNED    NOT NULL,
  title          VARCHAR(160)    NOT NULL,
  description    TEXT            NOT NULL,
  item_condition ENUM('neuf','tres_bon','bon','usage','a_reparer') NOT NULL, -- req 1 : etat
  status         ENUM('available','reserved','closed') NOT NULL DEFAULT 'available',
  location       VARCHAR(255)        NULL DEFAULT NULL,       -- lieu libre (texte)
  is_priority    TINYINT(1)      NOT NULL DEFAULT 0,          -- reservee a des groupes d'amis
  end_priority_at TIMESTAMP          NULL DEFAULT NULL,       -- fin de la restriction
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                                 ON UPDATE CURRENT_TIMESTAMP,
  closed_at      TIMESTAMP           NULL DEFAULT NULL,   -- req 6 : objet donne
  deleted_at     TIMESTAMP           NULL DEFAULT NULL,   -- suppression (owner/admin)
  PRIMARY KEY (id),
  KEY idx_listings_status (status),
  KEY idx_listings_category (category_id),
  KEY idx_listings_owner (owner_id),
  KEY idx_listings_priority_window (is_priority, end_priority_at),
  FULLTEXT KEY ft_listings_search (title, description),   -- req 2 : recherche
  CONSTRAINT fk_listings_owner
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_listings_category
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- priority_groups — quels groupes d'amis voient une annonce restreinte
-- ---------------------------------------------------------------------------
CREATE TABLE priority_groups (
  listing_id       BIGINT UNSIGNED NOT NULL,
  friends_group_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (listing_id, friends_group_id),
  KEY idx_priority_groups_group (friends_group_id),
  CONSTRAINT fk_priority_groups_listing
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
  CONSTRAINT fk_priority_groups_group
    FOREIGN KEY (friends_group_id) REFERENCES friends_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- listing_photos — carrousel de la fiche detail (req 4)
--
-- position ordonne les photos ; la premiere (position 0) sert de vignette dans
-- la grille (req 1).
-- ---------------------------------------------------------------------------
CREATE TABLE listing_photos (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id BIGINT UNSIGNED NOT NULL,
  url        VARCHAR(512)    NOT NULL,
  position   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_photos_listing (listing_id, position),
  CONSTRAINT fk_photos_listing
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- listing_interests — favoris / "je suis interesse" (bouton etoile, req 10)
--
-- Un enregistrement par (listing_id, user_id), pas un log append-only (UNIQUE
-- KEY ci-dessous) : on peut donc s'inscrire puis se desinscrire sans accumuler
-- de doublons.
-- ---------------------------------------------------------------------------
CREATE TABLE listing_interests (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id BIGINT UNSIGNED NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_interests_listing_user (listing_id, user_id),
  KEY idx_interests_user (user_id),
  CONSTRAINT fk_interests_listing
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
  CONSTRAINT fk_interests_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- messages — un etudiant interesse contacte le donneur (req 5)
--
-- On conserve recipient_id (denormalise depuis listings.owner_id au moment de
-- l'envoi) pour tracer le destinataire meme si l'annonce change de main ou est
-- supprimee plus tard.
-- ---------------------------------------------------------------------------
CREATE TABLE messages (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id   BIGINT UNSIGNED NOT NULL,
  sender_id    BIGINT UNSIGNED NOT NULL,
  recipient_id BIGINT UNSIGNED NOT NULL,
  body         TEXT            NOT NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at      TIMESTAMP           NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_messages_listing (listing_id),
  KEY idx_messages_recipient (recipient_id, read_at),
  CONSTRAINT fk_messages_listing
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
  CONSTRAINT fk_messages_sender
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_messages_recipient
    FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- notifications — centre de notifications in-app (req 12)
--
-- Une ligne = un evenement destine a UN utilisateur (user_id). Le texte est
-- fige a l'ecriture (title/body) plutot que reconstruit a l'affichage : une
-- notification doit rester lisible meme si l'annonce a ete supprimee depuis.
-- listing_id / actor_id ne servent qu'aux liens et sont donc ON DELETE SET
-- NULL — perdre le lien ne doit jamais faire disparaitre la notification.
--
-- type est une chaine libre cote base (pas un ENUM) : ajouter un evenement ne
-- doit pas demander une migration. Valeurs produites aujourd'hui par
-- src/notifications.ts : listing_interest, listing_removed, report_created,
-- report_reviewed, account_blocked, account_unblocked.
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,               -- destinataire
  type       VARCHAR(60)     NOT NULL,
  title      VARCHAR(160)    NOT NULL,
  body       TEXT                NULL DEFAULT NULL,
  link       VARCHAR(512)        NULL DEFAULT NULL,  -- page a ouvrir au clic
  listing_id BIGINT UNSIGNED     NULL DEFAULT NULL,
  actor_id   BIGINT UNSIGNED     NULL DEFAULT NULL,  -- qui a declenche l'evenement
  read_at    TIMESTAMP           NULL DEFAULT NULL,
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Requete de reference : "mes notifications, les non lues d'abord".
  KEY idx_notifications_user (user_id, read_at, created_at),
  KEY idx_notifications_listing (listing_id),
  CONSTRAINT fk_notifications_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_listing
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE SET NULL,
  CONSTRAINT fk_notifications_actor
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- reports — signalement de contenu inapproprie (alimente la moderation, req 9)
-- ---------------------------------------------------------------------------
CREATE TABLE reports (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reporter_id BIGINT UNSIGNED     NULL,                  -- NULL si le compte a ete supprime
  listing_id  BIGINT UNSIGNED NOT NULL,
  reason      VARCHAR(255)    NOT NULL,
  status      ENUM('open','reviewed','dismissed') NOT NULL DEFAULT 'open',
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP           NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_reports_status (status),
  KEY idx_reports_listing (listing_id),
  KEY idx_reports_reporter (reporter_id),
  CONSTRAINT fk_reports_reporter
    FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_reports_listing
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- moderation_logs — historique des actions de moderation (req 9)
--
-- "acces historique des modifications" : chaque action admin (blocage,
-- suppression) laisse une trace. details (JSON) peut contenir un
-- avant/apres. On conserve la ligne meme si l'admin est supprime (actor_id
-- passe a NULL) pour ne pas perdre l'historique.
-- ---------------------------------------------------------------------------
CREATE TABLE moderation_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id    BIGINT UNSIGNED     NULL,
  action      VARCHAR(120)     NOT NULL,   -- ex: block_user, delete_listing, update_listing
  target_type ENUM('user','listing') NOT NULL,
  target_id   BIGINT UNSIGNED NOT NULL,
  details     JSON                NULL DEFAULT NULL, -- motif
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_modlog_target (target_type, target_id),
  KEY idx_modlog_actor (actor_id),
  KEY idx_modlog_created (created_at),
  CONSTRAINT fk_modlog_actor
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- app_settings — parametres de l'application modifiables par un admin
--
-- Table cle/valeur volontairement generique. Une cle absente = "valeur par
-- defaut du code" : on n'insere donc rien au seed, et supprimer une ligne
-- revient a revenir au defaut.
--
-- Utilisee aujourd'hui par l'analyse IA des photos (cles ai.model,
-- ai.system_prompt, ai.user_prompt — voir src/aiSettings.ts) pour que les
-- prompts soient modifiables depuis /admin-ai.html sans redeploiement.
-- ---------------------------------------------------------------------------
CREATE TABLE app_settings (
  setting_key   VARCHAR(64)     NOT NULL,
  setting_value TEXT                NULL,
  updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by    BIGINT UNSIGNED     NULL,
  PRIMARY KEY (setting_key),
  CONSTRAINT fk_app_settings_user
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
