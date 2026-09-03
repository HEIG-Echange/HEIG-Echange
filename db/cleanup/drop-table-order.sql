-- HEIG-Echange — ordre de suppression des tables du schema v2
-- (db/init/01-schema-v2.sql)
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
