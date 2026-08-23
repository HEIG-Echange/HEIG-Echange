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
- **Framework backend :** Express 5, connecté à MariaDB via `mysql2` (pool dans `src/db.ts`). API REST complète : auth/session, annonces, photos, catégories, intérêts, signalements, administration — voir `docs/api.md`.
- **Base de données :** MariaDB 11.4 (LTS), tourne uniquement dans Docker (pas de serveur SQL sur l'hôte), administrée via **phpMyAdmin** (jamais exposé sur Internet — accès admin via tunnel SSH)
- **Frontend applicatif :** pages HTML statiques + modules ES servis depuis `public/` par Express (pas de framework, pas de bundler), Tailwind par CDN. Responsive mobile / tablette / desktop — voir `docs/frontend.md`.
- **Emails :** service HTTP interne (`src/mail.ts`, variables `MAILER_*`). Sert la confirmation d'adresse à l'inscription et la reconfirmation semestrielle. Gabarits dans `src/mailTemplates.ts`.
- **IA (optionnelle) :** analyse d'une photo d'objet pour pré-remplir le formulaire (`src/ai.ts`, `ANTHROPIC_API_KEY`). Absente ⇒ l'endpoint répond 503, le reste fonctionne.
- **Tests :** Vitest + Supertest. Les tests de routes remplacent le pool MySQL par un faux pool piloté par motif SQL (`test/support/mockPool.ts`) : la CI n'a pas besoin d'une base.
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
├── bruno/                  # collection de requêtes API (Bruno) + suite de test
├── db/
│   ├── init/01-schema.sql  # schéma MariaDB (joué UNIQUEMENT sur un volume vide)
│   ├── init/02-seed.sql    # catégories de référence
│   ├── migrations/00X-*.sql# à appliquer à la main sur une base déjà peuplée
│   └── schema.mwb          # MySQL Workbench
├── docs/
│   ├── description-projet.md   # objectifs, requirements, architecture, choix techniques
│   ├── processus-travail.md    # git flow (section équipe/rôles annoncée par le README mais absente)
│   ├── api.md                  # doc complète de l'API REST
│   ├── frontend.md             # organisation du front, paliers responsive, densités
│   ├── base-de-donnees.md      # schéma + phpMyAdmin + backup/restore + migrations + seed
│   ├── deploiement.md          # doc complète du pipeline SSH staging/prod
│   ├── notes-presentation-sofia.md  # notes perso de présentation (pas un livrable d'équipe)
│   └── mockups/README.md       # vide (les exports PNG sont dans mockup/mobile/)
├── landing-page/index.html
├── mockup/mobile/*.png         # exports de la maquette Figma (référence visuelle)
├── public/                     # frontend applicatif servi par Express
├── scripts/
│   ├── {db-backup,db-restore,deploy-remote}.sh
│   └── seed_demo_data.py       # peuple l'app avec les données de la maquette
├── src/
│   ├── app.ts, server.ts
│   ├── config.ts               # PUBLIC_BASE_URL, absoluteUrl(), UPLOAD_DIR
│   ├── db.ts, mail.ts, mailTemplates.ts, ai.ts, upload.ts
│   ├── auth/{validateEmail,emailVerification}.ts
│   ├── jobs/emailReverification.ts
│   ├── middleware/{requireAuth,requireAdmin}.ts
│   └── routes/{auth,listings,categories,users,reports,admin}.ts
├── test/                       # Vitest + Supertest (+ test/support/mockPool.ts)
└── fick                        # fichier vide à la racine, résidu accidentel — à supprimer
```

## 4. Base de données — résumé du schéma

Voir `docs/base-de-donnees.md` pour le détail complet (accès phpMyAdmin, export/import, migrations). Tables : `users` (email `@hes-so.ch`/`@heig-vd.ch` vérifié par CHECK, rôle user/admin, soft delete, confirmation d'adresse), `categories`, `listings` (statut available/reserved/closed, recherche FULLTEXT), `listing_photos` (carrousel), `listing_interests` (« je suis intéressé »), `messages` (contact donneur↔intéressé), `reports` + `moderation_logs` (signalement et historique de modération).

**À savoir avant de toucher au schéma :** `db/init/*.sql` n'est joué qu'au tout premier démarrage (volume vide). Sur une base déjà peuplée, il faut écrire une migration dans `db/migrations/` **et** mettre `01-schema.sql` à jour pour les installations neuves — les deux, sinon les deux chemins divergent.

**Suspension à 6 mois :** il n'existe volontairement pas de colonne `is_suspended`. L'état d'un compte est *calculé* à partir de `email_verified_at` (`src/auth/emailVerification.ts`), donc il est exact même si le job de relance n'a pas tourné. Les requêtes publiques filtrent avec le fragment `activeAccountSql()` — ne pas dupliquer cette condition à la main dans une nouvelle requête.

## 5. Git flow

- `main` protégée et toujours déployable (règle créée mais désactivée jusqu'au livrable)
- Une branche par feature depuis `main` (ex. `feature/landing-page`, `feature/api` — branche courante au moment de la rédaction de ce fichier)
- Push → pull request vers `main` → review d'un autre membre + CI verte → merge → déploiement automatique en staging

## 6. Ce qui est fait vs. ce qui reste (Semaine 1 → objectifs semaines 2-4)

**Fait :**
- Description du projet complète (`docs/description-projet.md`)
- Git flow décrit
- Landing page (statique)
- Schéma de base de données complet, documenté, avec migrations versionnées
- Pipeline CI (lint/test/build) et CD (déploiement SSH staging/prod avec healthcheck) fonctionnels
- Dockerfile multi-stage propre (dev/verify/runner)
- Backend Express connecté à MariaDB, API REST complète (`docs/api.md`) + collection Bruno
- Comptes email/mot de passe (bcrypt, sessions), rôles user/admin, modération, signalements
- Confirmation d'adresse à l'inscription **et** reconfirmation obligatoire tous les 6 mois : sans elle le compte est suspendu et ses annonces masquées
- Annonces : CRUD, recherche FULLTEXT, filtres, photos multiples (ajout/suppression/réordonnancement), édition après publication, intérêts
- Liens de partage (QR annonce et profil, mailto, URL d'images) tous construits sur `PUBLIC_BASE_URL`
- Frontend applicatif responsive mobile / tablette / desktop, avec affichage grille ou compact (`docs/frontend.md`)
- Script de peuplement `scripts/seed_demo_data.py` (données de la maquette)
- Exports de la maquette dans `mockup/mobile/`

**Reste à faire :**
- Relier la landing page à GitHub Pages / au pipeline
- Committer/référencer les mockups dans `docs/mockups/` (aujourd'hui vide ; les PNG sont dans `mockup/mobile/`)
- Ajouter la section équipe/rôles dans `docs/processus-travail.md` (annoncée par l'index mais absente)
- Nettoyer `cd.yml` (un ancien job `deploy` basé sur Render/GHCR traîne encore sous le nouveau système staging/prod — a priori mort mais pas supprimé) et le fichier vide `fick` à la racine
- SSO Microsoft (prévu au départ, non implémenté : l'auth actuelle est email + mot de passe)
- Groupes d'« amis prioritaires » : l'écran existe mais ne persiste qu'en `localStorage`, rien côté API/base
- Table `messages` présente en base mais aucun endpoint : le contact passe aujourd'hui par un `mailto:`
- Tests automatisés du frontend (aucun environnement DOM en CI — voir la section « Limites connues » de `docs/frontend.md`)

## 7. Plan proposé semaines 2–4 (à valider avec l'équipe, rôles pas confirmés)

Proposition basée sur 4 spécialités déclarées par l'utilisatrice : data, logiciel, réseau, sécurité. **Le mapping nom↔spécialité n'est pas confirmé.**

**Semaine 2 — Fondations :** Data = connecter Express à MariaDB (driver + requêtes) ; Réseau = SSO Microsoft + stabiliser le déploiement ; Logiciel = premiers endpoints (liste/création d'annonces) + démarrage frontend ; Sécurité = sessions/cookies + premier `npm audit`.

**Semaine 3 — Fonctionnalités principales :** recherche/filtres, fiche détail, demande d'objet + lien Teams, rôles admin/user, validation des entrées.

**Semaine 4 — Tests, finitions, présentation :** tests (pyramide unitaires/intégration/e2e), audit sécurité final, démo live du pipeline, documentation finale (lancer en local, contribuer), répétition de la présentation.

## 8. Présentation

Fil rouge attendu par la grille d'évaluation : problème → histoire → solution. Notes de Sofia (problématique/solution) dans `docs/notes-presentation-sofia.md`. Répartition prévue à l'oral : Sofia = problématique/solution, Vincent = mockups + landing page, Jeffrey = processus de travail, Adam = pipeline/démo.
