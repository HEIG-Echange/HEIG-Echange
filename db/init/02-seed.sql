-- ---------------------------------------------------------------------------
-- HEIG-Echange — donnees de reference (categories)
--
-- Execute apres 01-schema.sql, uniquement au premier demarrage. INSERT IGNORE
-- rend le fichier idempotent si on choisit un jour de le rejouer a la main.
-- ---------------------------------------------------------------------------
SET NAMES utf8mb4;

INSERT IGNORE INTO categories (slug, label) VALUES
  ('livres',       'Livres & syllabus'),
  ('mobilier',     'Mobilier'),
  ('electronique', 'Electronique & informatique'),
  ('vetements',    'Vetements'),
  ('materiel',     'Materiel de cours'),
  ('cuisine',      'Cuisine & electromenager'),
  ('sport',        'Sport & loisirs'),
  ('divers',       'Divers');


