# Images Docker publiées dans GitHub Container Registry

Chaque exécution du workflow **CD** publie l'image applicative dans
`ghcr.io/<organisation>/<depot>`. Trois tags sont publiés :

- `<sha-complet-du-commit>` : tag **immuable à utiliser en production** ;
- `<nom-de-branche>` : raccourci qui avance à chaque publication de la branche ;
- `latest` : dernière image publiée, pratique seulement pour des essais.

Le déploiement automatique utilise exclusivement le tag SHA, jamais `latest`.

## Contenu exact de l'artefact applicatif

L'image GHCR est construite depuis la cible `runner` de
[`Dockerfile`](../Dockerfile). Elle contient le runtime Node Alpine,
l'utilisateur non privilégié `node`, le healthcheck HTTP, `dist/` (JavaScript
compilé depuis `src/`), les fichiers statiques `public/`, `package.json` et
uniquement les dépendances de production dans `node_modules/`.

Elle ne contient pas les sources TypeScript, tests, Bruno, dépendances de
développement, fichiers `.env`, historique Git, données MariaDB, images MinIO
ni volumes Docker. Aucun secret ni donnée d'exploitation n'est donc incorporé
à l'image.

L'artefact d'exécution complet est le couple **image GHCR + fichiers Compose
versionnés** : [`compose.yaml`](../compose.yaml), [`db/init/`](../db/init/) et
les images amont `mariadb:11.4`, avec le profil `tools`, phpMyAdmin.
Compose crée les volumes persistants `db-data`, et `uploads-data`;
ils ne font pas partie d'une image et se sauvegardent séparément.

## Démarrer une version déterminée sur une machine vierge

1. Installer Docker Engine et Docker Compose v2, puis récupérer les fichiers
   du même commit que le tag image (au minimum `compose.yaml` et `db/init/`).
2. Créer un `.env` depuis `.env.example` et remplacer les mots de passe et
   `SESSION_SECRET` de démonstration. Renseigner aussi `PUBLIC_BASE_URL` et
   `APP_PORT`.
3. Si le package GHCR est privé, créer un PAT GitHub `read:packages` puis :

   ```bash
   export CR_PAT='<token-lecture-packages>'
   echo "$CR_PAT" | docker login ghcr.io -u '<utilisateur-github>' --password-stdin
   unset CR_PAT
   ```

   Pour un package public, cette étape n'est pas nécessaire. La connexion doit
   être faite pour l'utilisateur qui lance Compose, y compris celui du CD.
4. Choisir le SHA du job `publish-image` et lancer exactement cette version :

   ```bash
   export APP_IMAGE=ghcr.io/<organisation>/<depot>:<sha-complet-du-commit>
   docker compose pull app
   docker compose up -d --no-build --wait
   ```

Au premier démarrage, le volume `db-data` est vide : MariaDB exécute les SQL de
`db/init/`. La base est ainsi initialisée avec le schéma et les données de
référence les plus récents **du commit correspondant à l'image**. Les scripts
ne sont exécutés qu'une fois par volume vide. Pour réinitialiser une machine
(destructif) :

```bash
docker compose down -v
docker compose up -d --no-build --wait
```

## Vérifier et revenir à une version

```bash
docker image inspect "$APP_IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
docker compose ps
```

Pour revenir en arrière, remplacer `APP_IMAGE` par un ancien SHA, refaire le
`pull` et le `up --no-build`. Cette opération restaure le binaire, pas les
données : restaurer au besoin `db_<environnement>_*.sql.gz` avec
`scripts/db-restore.sh`.


