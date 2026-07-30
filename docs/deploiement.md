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

Tout est porté par les **environnements GitHub** (`Settings > Environments`), un
par cible. C'est ce qui permet à staging et production de viser des machines,
des ports et des utilisateurs différents sans dupliquer le workflow.

### Variables (non sensibles)

| Variable | Requis | Défaut | Rôle |
|---|---|---|---|
| `DEPLOY_HOST` | oui | — | nom d'hôte ou IP de la machine |
| `DEPLOY_USER` | oui | — | utilisateur SSH, membre du groupe `docker` |
| `DEPLOY_PORT` | non | `22` | port SSH |
| `DEPLOY_PATH` | non | valeur du tableau ci-dessus | dossier de déploiement |

`DEPLOY_PATH` n'est à définir que pour sortir de l'arborescence par défaut : les
deux chemins sont déjà câblés dans `cd.yml`.

### Secrets

| Secret | Rôle |
|---|---|
| `DEPLOY_SSH_PRIVATE_KEY` | clé privée de déploiement, **sans passphrase** |
| `DEPLOY_SSH_KNOWN_HOSTS` | clé publique de l'hôte, pour vérifier la machine |

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

## Déploiement manuel d'urgence

Le script distant est utilisable à la main, sans pipeline, depuis une copie des
sources déjà présente dans le dossier :

```bash
cd /home/heigdeploy/heig/prod-pdg && IMAGE_TAG=production docker compose up --build -d --wait
```

## Retour arrière

Il n'y a pas encore de rollback automatique. Pour revenir en arrière, relancer
le workflow `CD` depuis le commit visé (onglet Actions → CD → Run workflow, en
choisissant la branche ou le tag). C'est la principale limite du modèle actuel :
comme l'image est construite sur la machine, il n'existe pas d'artefact
versionné à réinstaller directement.

