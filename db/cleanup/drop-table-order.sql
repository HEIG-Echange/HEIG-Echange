-- ---------------------------------------------------------------------------
-- HEIG-Echange — ordre de suppression des tables du schema v2
-- (db/init/01-schema-v2.sql)
--
-- A quoi ca sert : vider completement une base sans toucher au volume Docker
-- (repartir d'un schema propre en staging, rejouer un import, tester une
-- migration depuis zero). db/init/ ne se rejoue QUE sur un volume vide : ce
-- fichier est le seul moyen de repartir a neuf sans supprimer le volume.
--
-- Utilisation :
--
--   docker compose exec -T db \
--     mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE" \
--     < db/cleanup/drop-table-order.sql
--
--   puis rejouer le schema et les donnees de reference :
--   ... < db/init/01-schema-v2.sql   et   ... < db/init/02-seed.sql
--
-- ATTENTION : destructif. Faire une sauvegarde d'abord
-- (scripts/db-backup.sh, cf. docs/base-de-donnees.md).
--
-- L'ordre ci-dessous respecte les cles etrangeres : on part des tables
-- "feuilles" (celles que personne ne reference) et on remonte vers users, qui
-- est referencee par presque tout. Il est volontairement valable SANS
-- desactiver les contraintes, pour qu'une erreur revele une vraie dependance
-- oubliee plutot que d'etre masquee par FOREIGN_KEY_CHECKS = 0.
--
--   users        <- app_settings, notifications, moderation_logs, reports,
--                   messages, listing_interests, friends_group_members,
--                   friends_groups, listings
--   listings     <- notifications, reports, messages, listing_interests,
--                   listing_photos, priority_groups
--   friends_groups <- friends_group_members, priority_groups
--   categories   <- listings
-- ---------------------------------------------------------------------------
SET NAMES utf8mb4;

-- 1. Tables qui ne sont referencees par personne -----------------------------
DROP TABLE IF EXISTS app_settings;        -- -> users
DROP TABLE IF EXISTS moderation_logs;     -- -> users
DROP TABLE IF EXISTS notifications;       -- -> users, listings
DROP TABLE IF EXISTS reports;             -- -> users, listings
DROP TABLE IF EXISTS messages;            -- -> users, listings
DROP TABLE IF EXISTS listing_interests;   -- -> users, listings
DROP TABLE IF EXISTS listing_photos;      -- -> listings
DROP TABLE IF EXISTS priority_groups;     -- -> listings, friends_groups

-- 2. Tables intermediaires ---------------------------------------------------
DROP TABLE IF EXISTS friends_group_members;  -- -> users, friends_groups
DROP TABLE IF EXISTS friends_groups;         -- -> users
DROP TABLE IF EXISTS listings;               -- -> users, categories

-- 3. Tables racines ----------------------------------------------------------
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS users;
