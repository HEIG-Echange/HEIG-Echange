# CLAUDE.md — HEIG-Échange

Contexte pour Claude Code (ou tout futur agent) reprenant ce projet. Projet scolaire (Projet de groupe / PDG, HEIG-VD), 4 semaines au total. Semaine 1 = définition + amorce du pipeline (terminée). Semaines 2 à 4 = réalisation du MVP.

## 1. Le projet

**Repo :** https://github.com/HEIG-Echange/HEIG-Echange (privé)

**Problématique :** les étudiants ont peu d'argent, et pourtant plein d'objets utilisables dorment dans les chambres (livres, matériel d'anciens semestres, meubles de fin de bail). Aujourd'hui, donner un objet passe par des groupes WhatsApp, des affiches dans les couloirs ou des mails jamais lus — aucun endroit centralisé, portée limitée à un petit cercle, coordination qui se perd entre plusieurs canaux. L'école a même une étagère physique pour ça, mais elle a les mêmes limites : pas de moyen de faire une demande précise, peu de visibilité.

**Solution :** HEIG-Échange, plateforme de don d'objets entre étudiants de la HEIG-VD. Connexion via le compte Microsoft de l'école (aucun mot de passe stocké), publication/recherche/filtre d'annonces par catégorie, demande d'un objet trackée dans l'app, contact et rendez-vous via Teams, clôture de l'annonce une fois l'objet donné.

Détail complet (objectifs, requirements fonctionnels F1–F13, non-fonctionnels, itérations futures, architecture préliminaire, choix techniques) : **`docs/description-projet.md`**.

## 2. Équipe (4 personnes, à confirmer/ajuster avec le groupe)

- **Vincent Bruzzese** — mockups (Figma / Figma Make), a présenté la partie mockups/landing page
- **Jeffrey Mvutu Mabilama** — réseau/infra ; a manifestement construit une bonne partie du pipeline Docker/DB/déploiement (le label OCI du Dockerfile référence `gitlab.com/jeffmvutuheig/heig-echange-luna`, probablement son dépôt de travail personnel/miroir)
- **Sofia Henriques Garfo** (moi / l'utilisatrice de ce Claude) — problématique/solution à la présentation, responsable de la landing page
s. Point non résolu en particulier : qui fait le frontend de l'application (pas seulement la landing page) — pas assigné à ce jour.

Le prof veut que tout le monde parle à la présentation (~5 min chacun). Rappel : toujours déposer les livrables sur Teams.

## 3. Stack technique (état réel du repo, vérifié)

- **Langage / runtime :** TypeScript, Node.js 22 (image Docker `node:22.23.2-alpine3.24`, figée par tag ET digest)
- **Framework backend :** Express 5
- **Base de données :** MariaDB 11.4 (LTS), tourne uniquement dans Docker (pas de serveur SQL sur l'hôte), administrée via **phpMyAdmin** (jamais exposé sur Internet — accès admin via tunnel SSH)
- **Tests :** Vitest + Supertest
- **Lint :** ESLint (config flat)
- **CI :** GitHub Actions — lint, tests, build, `npm audit`, build de l'image Docker cible `verify`
- **CD :** GitHub Actions → déploiement **par SSH** sur une machine distante (pas de registry Docker externe pour la version actuelle) :
  - `staging` : automatique à chaque merge sur `main`
  - `production` : déclenchement manuel (Actions → CD → Run workflow), peut exiger une approbation
  - Le pipeline envoie l'archive des sources (`git archive` + `scp`), puis lance `docker compose up --build -d --wait` sur la machine. Healthcheck HTTP intégré (`/health`), sauvegarde `pre-deploy-*.sql.gz` automatique avant chaque déploiement.
  - Secrets nécessaires : `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PORT` (défaut 22), `DEPLOY_SSH_PRIVATE_KEY`, `DEPLOY_SSH_KNOWN_HOSTS` (secrets de repo, partagés), `DEPLOY_PATH` (secret **par environnement**, staging ≠ prod)
  - Pas encore de rollback automatique — revenir en arrière = relancer le workflow CD depuis un commit antérieur
- **Landing page :** HTML statique + Tailwind CDN dans `landing-page/index.html`. **Pas encore reliée au pipeline CI/CD ni à GitHub Pages** — contrairement à ce que demande le kickoff ("landing page hébergée sur GitHub Pages, déployée automatiquement"). À faire : soit ajouter un job GitHub Pages séparé, soit clarifier si elle doit être servie autrement.
- **Mockups :** Figma Make (prototype React interactif complet, pas juste des images statiques) — se trouve en dehors de ce repo, dans un dossier local séparé (`Plateforme d'échange d'objets`), pas encore committé/référencé dans `docs/mockups/` (qui est actuellement vide malgré ce que dit `docs/README.md`)

### Fichiers clés
```
.
├── .github/workflows/{ci,cd,deploy,secrets-scan}.yml
├── Dockerfile              # multi-stage : deps / build / verify / dev / runner
├── compose.yaml            # exécution locale de l'image de prod
├── compose.dev.yaml        # rechargement à chaud pour le dev local
├── db/
│   ├── init/01-schema-v2.sql   # schéma MariaDB courant (v2 : + friends_groups, priority_groups, listing_interests, notifications, app_settings)
│   ├── archive/01-schema-v1.sql # ancien schéma, conservé pour référence
│   ├── cleanup/drop-table-order.sql # ordre de drop respectant les FK
│   ├── migrations/006-schema-v2.sql # v1 (état prod) -> v2, idempotente
│   ├── init/02-seed.sql
│   └── schema.mwb          # MySQL Workbench
├── docs/
│   ├── description-projet.md   # objectifs, requirements, architecture, choix techniques
│   ├── processus-travail.md    # git flow (section équipe/rôles annoncée par le README mais absente)
│   ├── base-de-donnees.md      # doc complète du schéma + accès phpMyAdmin + backup/restore
│   ├── deploiement.md          # doc complète du pipeline SSH staging/prod
│   ├── notes-presentation-sofia.md  # notes perso de présentation (pas un livrable d'équipe)
│   └── mockups/README.md       # vide
├── landing-page/index.html
├── scripts/{db-backup,db-restore,deploy-remote}.sh
├── src/{app.ts,server.ts}      # squelette Express, pas encore connecté à la DB
├── test/app.test.ts
└── fick                        # fichier vide à la racine, probablement un résidu accidentel — à supprimer
```

## 4. Base de données — résumé du schéma

Voir `docs/base-de-donnees.md` pour le détail complet (accès phpMyAdmin, export/import, migrations). Tables : `users` (email `@hes-so.ch`/`@heig-vd.ch` vérifié par CHECK, rôle user/admin, soft delete), `categories`, `listings` (statut available/reserved/closed, recherche FULLTEXT), `listing_photos` (carrousel), `messages` (contact donneur↔intéressé), `reports` + `moderation_logs` (signalement et historique de modération).

**Écart à noter :** le schéma SQL est prêt et documenté, mais `src/app.ts`/`src/server.ts` ne s'y connectent pas encore (pas de driver DB dans `package.json`) — le backend applicatif (routes CRUD sur `listings`, etc.) reste à écrire.

## 5. Git flow

- `main` protégée et toujours déployable (règle créée mais désactivée jusqu'au livrable)
- Une branche par feature depuis `main` (ex. `feature/landing-page`, `feature/api` — branche courante au moment de la rédaction de ce fichier)
- Push → pull request vers `main` → review d'un autre membre + CI verte → merge → déploiement automatique en staging

## 6. Ce qui est fait vs. ce qui reste (Semaine 1 → objectifs semaines 2-4)

**Fait :**
- Description du projet complète (`docs/description-projet.md`)
- Git flow décrit
- Landing page (statique)
- Mockups Figma (hors repo)
- Schéma de base de données complet et documenté
- Pipeline CI (lint/test/build) et CD (déploiement SSH staging/prod avec healthcheck) fonctionnels pour l'app elle-même
- Dockerfile multi-stage propre (dev/verify/runner)

**Reste à faire :**
- Connecter le backend Express à MariaDB (aucun driver DB installé pour l'instant)
- Implémenter les endpoints API (CRUD annonces, recherche/filtres, demandes, messages)
- Choisir/construire le frontend applicatif (pas juste la landing page) — **personne assignée à ce jour**
- Contrôle d'accès par rôle (user/admin) et sécurité applicative
- Relier la landing page à GitHub Pages / au pipeline
- Committer les mockups dans `docs/mockups/`
- Ajouter la section équipe/rôles dans `docs/processus-travail.md` (annoncée par l'index mais absente)
- Nettoyer `cd.yml` (un ancien job `deploy` basé sur Render/GHCR traîne encore sous le nouveau système staging/prod — a priori mort mais pas supprimé) et le fichier vide `fick` à la racine

## 7. Plan proposé semaines 2–4 (à valider avec l'équipe, rôles pas confirmés)

Proposition basée sur 4 spécialités déclarées par l'utilisatrice : data, logiciel, réseau, sécurité. **Le mapping nom↔spécialité n'est pas confirmé.**

**Semaine 2 — Fondations :** Data = connecter Express à MariaDB (driver + requêtes) ; Réseau = SSO Microsoft + stabiliser le déploiement ; Logiciel = premiers endpoints (liste/création d'annonces) + démarrage frontend ; Sécurité = sessions/cookies + premier `npm audit`.

**Semaine 3 — Fonctionnalités principales :** recherche/filtres, fiche détail, demande d'objet + lien Teams, rôles admin/user, validation des entrées.

**Semaine 4 — Tests, finitions, présentation :** tests (pyramide unitaires/intégration/e2e), audit sécurité final, démo live du pipeline, documentation finale (lancer en local, contribuer), répétition de la présentation.

## 8. Présentation

Fil rouge attendu par la grille d'évaluation : problème → histoire → solution. Notes de Sofia (problématique/solution) dans `docs/notes-presentation-sofia.md`. Répartition prévue à l'oral : Sofia = problématique/solution, Vincent = mockups + landing page, Jeffrey = processus de travail, Adam = pipeline/démo.
