-- ---------------------------------------------------------------------------
-- Migration 002 — verification d'email a l'inscription
--
-- db/init/01-schema.sql ne se rejoue que sur un volume vide. Pour une base
-- deja peuplee, appliquer cette migration manuellement :
--
--   docker compose exec -T db \
--     mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE" \
--     < db/migrations/002-email-verification.sql
--
-- Idempotent : n'ajoute chaque colonne que si elle est absente.
-- ---------------------------------------------------------------------------

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'email_verified_at'
);
SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMP NULL DEFAULT NULL AFTER password_hash',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'verification_code'
);
SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE users ADD COLUMN verification_code VARCHAR(8) NULL DEFAULT NULL AFTER email_verified_at',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'verification_code_expires_at'
);
SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE users ADD COLUMN verification_code_expires_at TIMESTAMP NULL DEFAULT NULL AFTER verification_code',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
