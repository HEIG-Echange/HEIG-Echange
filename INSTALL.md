# Procédure d'installation locale — HEIG-Echange

Ce document décrit comment lancer le projet **HEIG-Echange** en local sur une machine de développement.

## Prérequis

Avant de démarrer le projet en local, les outils suivants doivent être installés :

- Git, pour cloner le dépôt.
- Docker

## Récupération du code

Cloner le dépôt puis se placer dans son dossier local :

```bash
git clone https://github.com/HEIG-Echange/HEIG-Echange.git
cd HEIG-Echange
```

## Configuration de l'environnement

Le dépôt fournit un fichier `.env.example` à copier en `.env` pour définir les variables utilisées par l'application et les conteneurs.

```bash
cp .env.example .env
```
Les variables principales à vérifier sont les suivantes :

- `PORT=3000`, qui correspond au port d'écoute de l'application lors d'une exécution locale sans Docker.
- `APP_PORT=3000`, qui correspond au port exposé sur la machine hôte via Docker Compose.
- `MARIADB_DATABASE=heig_echange`, `MARIADB_USER=heig`, `MARIADB_PASSWORD`, et `MARIADB_ROOT_PASSWORD`, qui configurent la base MariaDB du projet.
- `DB_HOST=db` et `DB_PORT=3306`, qui permettent à l'application de joindre la base via le nom de service Docker `db`.
- `SESSION_SECRET`, qui doit être remplacé par une valeur secrète propre à l'environnement local.
- `COOKIE_SECURE=false`, à conserver en local sans HTTPS, faute de quoi aucun cookie de session ne serait envoyé.
- `PUBLIC_BASE_URL=http://localhost:3000`, qui convient pour un usage local sans slash final.
- `PHPMYADMIN_PORT=8082`, utilisé si le profil Docker `tools` est activé.
- `ANTHROPIC_API_KEY`, variable optionnelle ; si elle est absente, l'application reste fonctionnelle mais sans préremplissage IA des photos.

## Lancement avec Docker


### Lancement standard

```bash
docker compose up -d
```

Cette commande utilise `compose.yaml` et démarre les services définis par défaut dans le projet.


### Lancement avec phpMyAdmin

```bash
docker compose --profile tools up -d
```
Le fichier `.env.example` précise que phpMyAdmin est exposé sur le port `8082` lorsque le profil `tools` est utilisé.

## Accès aux services

Une fois les conteneurs démarrés, l'application est accessible par défaut via `http://localhost:3000` avec la configuration par défaut fournie dans `.env.example`.

Si le profil `tools` est activé, phpMyAdmin est accessible par défaut `http://localhost:8082`.

## Jeu de données d'exemple

Le script `scripts/seed_sample_data.py` remplit une instance avec des données de
démonstration : 10 comptes étudiants (`essai1@heig-vd.ch` … `essai10@heig-vd.ch`),
un compte administrateur (`echange.admin@heig-vd.ch`), et 30 annonces réparties
sur les 5 premiers comptes d'essai (6 chacun), chacune avec 1 à 3 photos
générées. Tous les comptes partagent le mot de passe `heigpdg2026`.

Il n'utilise que la bibliothèque standard Python : aucun `pip install`.

Le script crée les comptes et les annonces via l'API HTTP, comme un vrai
utilisateur. Il a donc besoin que l'application expose les codes de
confirmation d'email, ce que fait la surcouche de développement
(`EXPOSE_VERIFICATION_CODE_FOR_TESTING=true` dans `compose.dev.yaml`). **Ne
jamais activer cette variable en production.**

### Base neuve, puis peuplement

```bash
python3 scripts/seed_sample_data.py --reset
```

`--reset` est **destructif** : il détruit les volumes Docker (base de données
et images déjà envoyées), relance la stack de développement — MariaDB rejoue
alors `db/init/01-schema-v2.sql` et `db/init/02-seed.sql` sur un volume vide —
puis peuple l'instance. Une confirmation est demandée (`--yes` pour l'éviter).

### Instance déjà démarrée

```bash
python3 scripts/seed_sample_data.py
```

Le script est réentrant : relancé sur une base déjà peuplée, il réutilise les
comptes existants et ne republie que les annonces manquantes.

### Options utiles

- `--dry-run` : affiche ce qui serait créé, sans rien envoyer.
- `--base-url https://staging.exemple.ch` : cible une autre instance.
- `--password <valeur>` : change le mot de passe commun (8 caractères minimum).
- `--photos-dir ./mes-photos` : utilise de vraies images au lieu des visuels générés.
- `--skip-admin-promotion` : ne passe pas le compte admin en rôle `admin`.

L'API n'expose volontairement aucune route permettant de s'attribuer les droits
d'administration : le passage de `echange.admin@heig-vd.ch` en rôle `admin` est
la seule étape écrite directement en base, via `docker compose exec db`. Si
Docker n'est pas joignable, le script affiche la requête à jouer soi-même dans
phpMyAdmin :

```sql
UPDATE users SET role = 'admin' WHERE email = 'echange.admin@heig-vd.ch';
```
