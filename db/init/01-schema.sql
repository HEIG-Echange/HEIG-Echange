-- ---------------------------------------------------------------------------
-- HEIG-Echange — schema de la base de donnees
--
-- Ce fichier est execute par MariaDB UNE SEULE FOIS, au premier demarrage du
-- conteneur (volume de donnees vide). Il ne rejoue pas sur un volume existant :
-- pour faire evoluer le schema d'une base deja peuplee, ecrire une migration
-- versionnee, ne pas modifier ce fichier en esperant qu'il se rejoue.
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
-- ---------------------------------------------------------------------------
SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ---------------------------------------------------------------------------
-- users — comptes etudiants et administrateurs
--
-- L'authentification se fait via l'ecosysteme Microsoft de l'ecole : on ne
-- stocke donc aucun mot de passe ici. Le CHECK sur le domaine est une seconde
-- barriere ; la validation applicative reste la reference (elle gere aussi la
-- casse, les alias, etc.).
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email          VARCHAR(255)    NOT NULL,
  display_name   VARCHAR(120)    NOT NULL,
  avatar_url     VARCHAR(512)        NULL DEFAULT NULL,
  password_hash  VARCHAR(255)    NOT NULL,                    -- hash bcrypt, jamais en clair
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
-- listings — les annonces (req 1, 3, 6)
--
-- "condition" est un mot reserve SQL : la colonne s'appelle item_condition.
-- L'index FULLTEXT alimente la recherche en temps reel (req 2).
-- ---------------------------------------------------------------------------
CREATE TABLE listings (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_id       BIGINT UNSIGNED NOT NULL,               -- req 1 : proprietaire
  category_id    INT UNSIGNED    NOT NULL,
  title          VARCHAR(160)    NOT NULL,
  description    TEXT            NOT NULL,
  item_condition ENUM('neuf','tres_bon','bon','usage','a_reparer') NOT NULL, -- req 1 : etat
  status         ENUM('available','reserved','closed') NOT NULL DEFAULT 'available',
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                                 ON UPDATE CURRENT_TIMESTAMP,
  closed_at      TIMESTAMP           NULL DEFAULT NULL,   -- req 6 : objet donne
  deleted_at     TIMESTAMP           NULL DEFAULT NULL,   -- suppression (owner/admin)
  PRIMARY KEY (id),
  KEY idx_listings_status (status),
  KEY idx_listings_category (category_id),
  KEY idx_listings_owner (owner_id),
  FULLTEXT KEY ft_listings_search (title, description),   -- req 2 : recherche
  CONSTRAINT fk_listings_owner
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_listings_category
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
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
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_modlog_target (target_type, target_id),
  KEY idx_modlog_actor (actor_id),
  KEY idx_modlog_created (created_at),
  CONSTRAINT fk_modlog_actor
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

