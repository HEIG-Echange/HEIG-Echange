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
