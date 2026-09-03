-- ---------------------------------------------------------------------------
-- Migration 003 — table listing_interests ("je suis interesse")
--
-- db/init/01-schema.sql ne se rejoue que sur un volume vide. Pour une base
-- deja peuplee, appliquer cette migration manuellement :
--
--   docker compose exec -T db \
--     mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE" \
--     < db/migrations/003-listing-interests.sql
--
-- Idempotent : CREATE TABLE IF NOT EXISTS, ne fait rien si la table existe
-- deja.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS listing_interests (
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
