-- ---------------------------------------------------------------------------
-- Migration 006 — mise a niveau vers le schema v2 (db/init/01-schema-v2.sql)
--
-- Point de depart suppose : une base au niveau 005-app-settings.sql, c'est-a-
-- dire l'etat de l'export de production db/production/old-db.sql (users,
-- categories, listings, listing_photos, listing_interests, messages, reports,
-- moderation_logs, app_settings).
--
-- Ce qu'elle ajoute — exactement ce qui manquait pour que l'API tourne :
--   1. listings.is_priority / listings.end_priority_at (+ index) : les routes
--      /listings les selectionnent et les ecrivent depuis la fonctionnalite
--      "annonce reservee a mes groupes d'amis".
--   2. friends_groups, friends_group_members, priority_groups : tout
--      /friends-groups et le filtrage de visibilite des annonces.
--   3. notifications : centre de notifications in-app (/notifications).
--   4. index idx_reports_reporter : "mes signalements" cote utilisateur.
--
-- Application sur une base deja peuplee :
--
--   docker compose exec -T db \
--     mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE" \
--     < db/migrations/006-schema-v2.sql
--
-- Idempotente : chaque ALTER est conditionne par information_schema, chaque
-- table est creee avec IF NOT EXISTS. Rejouable sans effet de bord, y compris
-- sur une base ou 004-friend-groups.sql avait deja ete passee a la main.
-- ---------------------------------------------------------------------------

-- 1. listings.is_priority --------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'listings'
    AND COLUMN_NAME = 'is_priority'
);
SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE listings ADD COLUMN is_priority TINYINT(1) NOT NULL DEFAULT 0 AFTER location',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 1bis. listings.end_priority_at -------------------------------------------
-- NULL = pas de fenetre de restriction. Surtout pas DEFAULT CURRENT_TIMESTAMP :
-- une nouvelle annonce serait "expiree" des sa creation.
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'listings'
    AND COLUMN_NAME = 'end_priority_at'
);
SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE listings ADD COLUMN end_priority_at TIMESTAMP NULL DEFAULT NULL AFTER is_priority',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 1ter. index sur la fenetre de priorite -----------------------------------
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'listings'
    AND INDEX_NAME = 'idx_listings_priority_window'
);
SET @ddl := IF(
  @idx_exists = 0,
  'ALTER TABLE listings ADD INDEX idx_listings_priority_window (is_priority, end_priority_at)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. groupes d'amis ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS friends_groups (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(120)    NOT NULL,
  owner_id   BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                              ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP           NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_friends_groups_owner (owner_id),
  CONSTRAINT fk_friends_groups_owner
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS friends_group_members (
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

CREATE TABLE IF NOT EXISTS priority_groups (
  listing_id       BIGINT UNSIGNED NOT NULL,
  friends_group_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (listing_id, friends_group_id),
  KEY idx_priority_groups_group (friends_group_id),
  CONSTRAINT fk_priority_groups_listing
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
  CONSTRAINT fk_priority_groups_group
    FOREIGN KEY (friends_group_id) REFERENCES friends_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. notifications ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  type       VARCHAR(60)     NOT NULL,
  title      VARCHAR(160)    NOT NULL,
  body       TEXT                NULL DEFAULT NULL,
  link       VARCHAR(512)        NULL DEFAULT NULL,
  listing_id BIGINT UNSIGNED     NULL DEFAULT NULL,
  actor_id   BIGINT UNSIGNED     NULL DEFAULT NULL,
  read_at    TIMESTAMP           NULL DEFAULT NULL,
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notifications_user (user_id, read_at, created_at),
  KEY idx_notifications_listing (listing_id),
  CONSTRAINT fk_notifications_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_listing
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE SET NULL,
  CONSTRAINT fk_notifications_actor
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. index "mes signalements" ----------------------------------------------
-- Selon l'historique de la base, la colonne peut deja etre indexee sous le nom
-- de la contrainte (fk_reports_reporter, index cree implicitement par la FK) :
-- on ne cree le notre que si aucun index ne commence par reporter_id.
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'reports'
    AND COLUMN_NAME = 'reporter_id'
    AND SEQ_IN_INDEX = 1
);
SET @ddl := IF(
  @idx_exists = 0,
  'ALTER TABLE reports ADD INDEX idx_reports_reporter (reporter_id)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
