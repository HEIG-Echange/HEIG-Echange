-- ---------------------------------------------------------------------------
-- Migration 004 — reverification d'email tous les 6 mois
--
-- db/init/01-schema.sql ne se rejoue que sur un volume vide. Pour une base
-- deja peuplee, appliquer cette migration manuellement :
--
--   docker compose exec -T db \
--     mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE" \
--     < db/migrations/004-email-reverification.sql
--
-- Contenu :
--   1. users.reverification_reminder_sent_at — memorise l'envoi du rappel
--      "votre adresse expire bientot", pour que le job quotidien ne renvoie
--      pas un email par jour tant que l'utilisateur n'a pas reconfirme.
--   2. Index sur email_verified_at — la colonne est filtree a chaque listing
--      d'annonces (masquage des comptes suspendus) et par le job de relance.
--
-- Idempotent : n'ajoute la colonne et l'index que s'ils sont absents.
-- ---------------------------------------------------------------------------

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'reverification_reminder_sent_at'
);
SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE users ADD COLUMN reverification_reminder_sent_at TIMESTAMP NULL DEFAULT NULL AFTER verification_code_expires_at',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND INDEX_NAME = 'idx_users_email_verified'
);
SET @ddl := IF(
  @idx_exists = 0,
  'ALTER TABLE users ADD INDEX idx_users_email_verified (email_verified_at)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Les comptes confirmes il y a plus de 6 mois basculent "suspendus" des le
-- deploiement (leurs annonces disparaissent des listes). On remet leur rappel
-- a zero pour que le job leur envoie immediatement un code de reconfirmation.
UPDATE users
   SET reverification_reminder_sent_at = NULL
 WHERE email_verified_at IS NOT NULL
   AND email_verified_at <= (NOW() - INTERVAL 180 DAY);
