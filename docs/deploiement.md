# Déploiement

Le déploiement se fait par SSH sur une machine distante. Le pipeline envoie les
sources du commit, puis lance `docker compose up --build -d` dans le dossier de
l'environnement visé. La machine construit donc l'image elle-même.

## Vue d'ensemble

| Environnement | Déclenchement | Dossier par défaut sur la machine |
|---|---|---|
| `staging` | automatique au merge sur `main` | `/home/heigdeploy/heig/staging-pdg` |
| `production` | manuel (onglet Actions → CD → Run workflow) | `/home/heigdeploy/heig/prod-pdg` |

Chaîne complète : [cd.yml](../.github/workflows/cd.yml) valide le commit
(`docker build --target verify`), puis appelle
[deploy.yml](../.github/workflows/deploy.yml), qui pousse
[scripts/deploy-remote.sh](../scripts/deploy-remote.sh) dans le shell distant.

## Configuration du pipeline

Toute la configuration passe par des **secrets GitHub** (`Settings > Secrets and
variables > Actions`), transmis à `deploy.yml` via `secrets: inherit`. Deux
niveaux se combinent :

- **Secrets de repository** : partagés par staging et production. C'est le bon
  niveau tant que les deux environnements sont sur la **même machine**.
- **Secrets d'environnement** (`Settings > Environments > staging|production`) :
  pour chaque environnement. (Prioritaires sur clefs-valeurs des secrets de repository si même nom).

### Secrets de repository (partagés entre environnements)

Initialement, la machine serveur était hébergée dans un appartement (Raspberry Pi). Une règle de Firewall était ouverte. Pour des soucis de sécurité, les valeurs qui permettraient d identifier l IP, le port, le user ont été mis en secret.

| Secret | Requis | Défaut | Rôle |
|---|---|---|---|
| `DEPLOY_HOST` | oui | — | nom d'hôte ou IP de la machine |
| `DEPLOY_USER` | oui | — | utilisateur SSH, membre du groupe `docker` |
| `DEPLOY_PORT` | non | `22` | port SSH |
| `DEPLOY_SSH_PRIVATE_KEY` | oui | — | clé privée de déploiement **sans passphrase** (sinon pas automatisable dans le pipeline). à générer puis à attribuer à Github. Ajouter la clef publique dans le fichier `~/.ssh/authorized_keys` du serveur cible. |
| `DEPLOY_SSH_KNOWN_HOSTS` | oui | — | clé publique de l'hôte, pour vérifier la machine |

Exemple de valeur pour 

### Secret d'environnement (une valeur par environnement)

| Secret | Où | Rôle |
|---|---|---|
| `DEPLOY_PATH` | dans **chaque** environnement | dossier de déploiement de cet environnement |

`DEPLOY_PATH` **doit** être défini par environnement, car staging et production
visent des dossiers différents. Ne le mettez **pas** en secret de repository :
une valeur unique écraserait les deux environnements avec le même chemin.

Les chemins par défaut (`/home/heigdeploy/heig/staging-pdg` et
`/home/heigdeploy/heig/prod-pdg`) sont déjà câblés dans `cd.yml` (entrée
`deploy_path`) : `deploy.yml` s'en sert en repli si le secret d'environnement
`DEPLOY_PATH` est absent. Le définir explicitement reste recommandé.

La vérification de l'hôte est active (`StrictHostKeyChecking yes`). Récupérer la
ligne `known_hosts` depuis un poste de confiance :

```bash
ssh-keyscan -p 22 -t ed25519 srv.exemple.ch
```

## Préparation d'une machine

À faire une fois par machine, puis une fois par environnement.

### 1. Docker

Docker Engine 24+ avec le plugin Compose v2.24+. L'utilisateur de déploiement
doit pouvoir parler au démon sans `sudo` :

```bash
sudo usermod -aG docker heigdeploy
```

### 2. Clé de déploiement

Générer une paire dédiée (pas une clé personnelle), déposer la publique sur la
machine et la privée dans le secret `DEPLOY_SSH_PRIVATE_KEY` :

```bash
ssh-keygen -t ed25519 -N '' -C 'ci-deploy heig-echange' -f ./ci-deploy
```

### 3. Dossier de l'environnement

Le dossier doit exister avant le premier déploiement — le pipeline échoue avec
un message explicite s'il est absent, plutôt que de le créer à l'aveugle.

```bash
mkdir -p /home/heigdeploy/heig/staging-pdg
```

### 4. Fichier `.env`

Chaque dossier porte son propre `.env`, qui décide notamment **quel port est
ouvert sur la machine**. Il n'est jamais livré par le pipeline : il n'est pas
suivi par git, donc absent de l'archive envoyée, et survit aux déploiements.

`/home/heigdeploy/heig/staging-pdg/.env` :

```dotenv
APP_PORT=8081
COMPOSE_PROJECT_NAME=heig-echange-staging
```

`/home/heigdeploy/heig/prod-pdg/.env` :

```dotenv
APP_PORT=8080
COMPOSE_PROJECT_NAME=heig-echange-prod
```

`COMPOSE_PROJECT_NAME` doit différer entre les deux : sans lui, deux stacks sur
une même machine partageraient le même nom de projet Compose et se
remplaceraient mutuellement. `APP_PORT` doit lui aussi différer, sinon le second
déploiement échoue sur un conflit de port.

## Ce que fait le déploiement

1. `git archive` de l'arbre du commit — pas de fichier local parasite, pas
   d'historique git envoyé sur la machine.
2. `scp` de l'archive vers `/tmp` sur la machine.
3. Extraction dans le dossier de l'environnement, par-dessus les sources
   précédentes. Le `.env` et les fichiers non suivis sont conservés. Revers de
   cette approche : un fichier supprimé du dépôt reste présent sur la machine.
   Ce n'est pas gênant pour un build Docker, qui ne lit que ce que le
   `Dockerfile` copie explicitement, mais en cas de doute il suffit de vider le
   dossier en gardant le `.env` et de relancer le workflow.
4. `docker compose up --build -d --remove-orphans --wait`. Le `--wait` attend le
   healthcheck du conteneur : un démarrage cassé fait échouer le pipeline au
   lieu de passer inaperçu. En cas d'échec, `docker compose ps` et les 100
   dernières lignes de logs sont affichées dans le run.
5. `docker image prune` des images de plus d'une semaine, pour que les builds
   successifs ne remplissent pas le disque.

Le commit déployé est tracé dans le fichier `.release` du dossier, et dans les
labels OCI de l'image (`org.opencontainers.image.revision`) :

```bash
docker image inspect heig-echange:production --format '{{json .Config.Labels}}'
```

## Plusieurs instances sur une même machine (dev local)

Le même principe que pour staging/prod (section précédente) s'applique à deux
clones locaux du projet lancés en parallèle (ex. pour comparer deux branches).
Dans le `.env` de **chaque** clone :

```dotenv
APP_PORT=3001                          # doit différer entre les instances
PHPMYADMIN_PORT=8083                   # idem, si le profil "tools" est utilisé
COMPOSE_PROJECT_NAME=heig-echange-a     # doit différer entre les instances
```

`COMPOSE_PROJECT_NAME` est le point le plus facile à oublier : sans lui,
Compose dérive le nom de projet du nom du **dossier**. Deux clones portant le
même nom de dossier (ce qui est le comportement par défaut de `git clone`)
partagent alors le même nom de projet, donc le même volume `db-data` — la 2ᵉ
instance réutilise la base de données de la 1ʳᵉ au lieu d'en créer une neuve.
Symptôme typique : changer `MARIADB_USER`/`MARIADB_PASSWORD`/`MARIADB_DATABASE`
dans le `.env` de la 2ᵉ instance n'a aucun effet, car MariaDB n'applique ces
variables qu'à la toute première initialisation d'un volume vide. Voir les
commentaires de `.env.example` et `compose.yaml` pour le détail.

`DB_HOST`/`DB_PORT` n'ont en revanche pas besoin de changer : la base n'est
jamais publiée sur la machine hôte (pas de section `ports` sur le service
`db`), donc aucun conflit possible entre instances sur ce port.

### Accès à phpMyAdmin depuis une autre machine

Le service `phpmyadmin` (profil `tools`, à lancer avec `docker compose --profile tools up -d`) est publié sur `0.0.0.0` par défaut (i.e. joignable depuis une autre machine du réseau), pour nous permettre d administrer à distance la BDD.

En production, pour plus de sécurité, on limiterait par exemple l accès depuis la machine serveur.

Pour revenir à un accès local uniquement, définir`PHPMYADMIN_BIND_ADDRESS=127.0.0.1` dans le `.env` concerné.




## Déploiement manuel d'urgence

Le script distant est utilisable à la main, sans pipeline, depuis une copie des sources déjà présente dans le dossier :

```bash
cd /home/heigdeploy/heig/prod-pdg && IMAGE_TAG=production docker compose up --build -d --wait
```



## Retour arrière

Il n'y a pas encore de rollback automatique. Pour revenir en arrière, relancer
le workflow `CD` depuis le commit visé (onglet Actions → CD → Run workflow, en
choisissant la branche ou le tag). C'est la principale limite du modèle actuel :
comme l'image est construite sur la machine, il n'existe pas d'artefact
versionné à réinstaller directement.

