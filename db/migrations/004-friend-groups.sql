-- ---------------------------------------------------------------------------
-- Migration 004 — groupes d'amis + annonces restreintes/prioritaires
--
-- db/init/01-schema.sql ne se rejoue que sur un volume vide. Pour une base
-- deja peuplee, appliquer cette migration manuellement :
--
--   docker compose exec -T db \
--     mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE" \
--     < db/migrations/004-friend-groups.sql
--
-- Idempotent : ALTER TABLE listings verifie via information_schema avant
-- d'ajouter une colonne/un index, CREATE TABLE IF NOT EXISTS pour les
-- nouvelles tables.
--
-- Source du modele : export MySQL Workbench (Vincent) "Model_Staging_corr -
-- create only.sql". Ecarts volontaires par rapport a cet export, pour
-- rester coherent avec le reste du schema (voir db/init/01-schema.sql) :
--   - noms de colonnes FK au singulier : friends_group_id / user_id /
--     listing_id (l'export genere friends_groups_id / users_id / listings_id
--     par defaut a partir des noms de table au pluriel)
--   - nom de table priority_groups en minuscules (export : Priority_groups)
--   - id des 3 nouvelles tables en BIGINT UNSIGNED AUTO_INCREMENT (l'export
--     omet AUTO_INCREMENT, ce qui casse tout INSERT ne fournissant pas d'id)
--   - listings.is_priority en TINYINT(1) NOT NULL DEFAULT 0 (export : INT
--     NULL, sans valeur par defaut sure)
--   - listings.end_priority_at en TIMESTAMP NULL DEFAULT NULL (export :
--     DEFAULT CURRENT_TIMESTAMP, ce qui rendrait une nouvelle annonce
--     "expiree" des sa creation ; NULL = pas de fenetre de restriction)
--   - ON DELETE CASCADE sur les FK vers users/listings/friends_groups
--     (export : NO ACTION) — cf. convention du projet : suppression
--     toujours en soft delete (deleted_at), donc CASCADE ne se declenche
--     jamais en fonctionnement normal, mais reste correct pour les FK
--     vers priority_groups/friends_group_members qui n'ont pas de soft
--     delete propre
--   - friends_group_members : UNIQUE KEY (friends_group_id, user_id)
--     ajoutee (absente de l'export) pour rendre "ajouter un membre"
--     idempotent sans doublon
-- ---------------------------------------------------------------------------

-- listings.is_priority --------------------------------------------------
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

-- listings.end_priority_at -----------------------------------------------
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

-- index sur la fenetre de priorite ---------------------------------------
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

-- ---------------------------------------------------------------------------
-- friends_groups — un groupe d'amis, cree et possede par un utilisateur
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- friends_group_members — appartenance a un groupe d'amis
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- priority_groups — quels groupes d'amis voient une annonce restreinte
-- ---------------------------------------------------------------------------
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
