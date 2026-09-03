-- ---------------------------------------------------------------------------
-- Migration 001 — ajoute listings.location (lieu libre)
--
-- db/init/01-schema.sql ne se rejoue que sur un volume vide. Pour une base
-- deja peuplee, appliquer cette migration manuellement :
--
--   docker compose exec -T db \
--     mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE" \
--     < db/migrations/001-listings-location.sql
--
-- Idempotent : n'ajoute la colonne que si elle est absente.
-- ---------------------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'listings'
    AND COLUMN_NAME = 'location'
);

SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE listings ADD COLUMN location VARCHAR(255) NULL DEFAULT NULL AFTER status',
  'SELECT 1'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
