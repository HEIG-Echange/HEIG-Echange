-- ---------------------------------------------------------------------------
-- Migration 005 — table app_settings (parametres modifiables par un admin)
--
-- Sert aujourd'hui aux reglages de l'analyse IA des photos (modele Hugging
-- Face, prompt systeme, prompt utilisateur) : un admin peut les changer depuis
-- /admin-ai.html sans redeployer l'application.
--
-- db/init/01-schema.sql ne se rejoue que sur un volume vide. Pour une base
-- deja peuplee, appliquer cette migration manuellement :
--
--   docker compose exec -T db \
--     mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE" \
--     < db/migrations/005-app-settings.sql
--
-- Idempotent : CREATE TABLE IF NOT EXISTS, ne fait rien si la table existe
-- deja. Aucune ligne n'est inseree : une cle absente signifie "valeur par
-- defaut du code" (voir src/aiSettings.ts).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key   VARCHAR(64)     NOT NULL,
  setting_value TEXT                NULL,
  updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by    BIGINT UNSIGNED     NULL,
  PRIMARY KEY (setting_key),
  CONSTRAINT fk_app_settings_user
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
