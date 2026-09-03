#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Deploiement — partie executee SUR la machine distante.
#
# Le pipeline ne l'execute pas en local : il le pousse dans le shell distant
#   ssh ... "DEPLOY_PATH=... bash -s" < scripts/deploy-remote.sh
# Le script vit dans le depot (et non dans le YAML du workflow) pour rester
# relisable, versionne, et executable a la main en cas de deploiement d'urgence.
#
# Variables attendues (fournies par le pipeline) :
#   DEPLOY_PATH   dossier de deploiement, contient le .env de la machine
#   DEPLOY_ENV    staging | production
#   RELEASE_SHA   commit deploye
#   ARCHIVE       chemin de l'archive des sources deja envoyee sur la machine
#   APP_VERSION   version applicative (package.json), optionnelle
#   APP_IMAGE     reference GHCR immuable de l'application
# ---------------------------------------------------------------------------
set -euo pipefail

: "${DEPLOY_PATH:?DEPLOY_PATH est requis}"
: "${DEPLOY_ENV:?DEPLOY_ENV est requis}"
: "${RELEASE_SHA:?RELEASE_SHA est requis}"
: "${ARCHIVE:?ARCHIVE est requis}"
APP_VERSION="${APP_VERSION:-0.0.0}"
: "${APP_IMAGE:?APP_IMAGE est requis}"

# L'archive est supprimee quoi qu'il arrive, y compris en cas d'echec.
trap 'rm -f "$ARCHIVE"' EXIT

if [ ! -d "$DEPLOY_PATH" ]; then
  echo "erreur: le dossier $DEPLOY_PATH n'existe pas sur cette machine." >&2
  echo "        Preparation de la machine : voir docs/deploiement.md" >&2
  exit 1
fi

cd "$DEPLOY_PATH"

# Le .env porte la configuration propre a cette machine et a cet
# environnement : APP_PORT (port publie) et COMPOSE_PROJECT_NAME. Il n'est
# jamais livre par le pipeline — il n'est pas suivi par git, donc absent de
# l'archive, et survit donc a l'extraction ci-dessous.
if [ ! -f .env ]; then
  echo "erreur: .env manquant dans $DEPLOY_PATH" >&2
  echo "        C'est lui qui definit APP_PORT. Voir docs/deploiement.md" >&2
  exit 1
fi

if ! grep -Eq '^[[:space:]]*DB_BACKUP_PATH=.+' .env; then
  echo "erreur: DB_BACKUP_PATH manquant dans $DEPLOY_PATH/.env" >&2
  echo "        Voir docs/deploiement.md pour la preparation des sauvegardes." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "erreur: docker compose est indisponible pour l'utilisateur $(id -un)." >&2
  echo "        L'utilisateur doit appartenir au groupe docker." >&2
  exit 1
fi

echo "==> Mise a jour des sources vers ${RELEASE_SHA}"
tar -xzf "$ARCHIVE" -C "$DEPLOY_PATH"
printf '%s\n' "$RELEASE_SHA" > .release

# Le dump est fait avant l'arret du container
echo "==> Sauvegarde de la base (${DEPLOY_ENV})"
export DEPLOY_ENV="$DEPLOY_ENV"
dbbkpscript="./scripts/db-backup.sh"
bash $dbbkpscript || sh $dbbkpscript


# Reinjecte dans compose : tag d'image propre a l'environnement et
# tracabilite du commit dans les labels OCI de l'image construite.
export IMAGE_TAG="$DEPLOY_ENV"
export VERSION="$APP_VERSION"
export REVISION="$RELEASE_SHA"
export CREATED
CREATED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export APP_IMAGE

echo "==> Recuperation de l'image ${APP_IMAGE}"
docker compose pull app

echo "==> docker compose down (${DEPLOY_ENV})"
docker compose down


echo "==> docker compose up --profile tools --build -d (${DEPLOY_ENV})"
# echo "==> docker compose up --profile tools --no-build -d (${DEPLOY_ENV})"

# --wait fait echouer la commande si le healthcheck du conteneur ne passe pas :
# un demarrage casse remonte en echec de pipeline au lieu de passer inapercu.
if ! docker compose --profile tools up --build -d --remove-orphans --wait --wait-timeout 300; then
# if ! docker compose --profile tools up --no-build -d --remove-orphans --wait --wait-timeout 300; then
  echo "erreur: les services ne sont pas devenus sains." >&2
  docker compose ps || true
  docker compose logs --tail=100 || true
  exit 1
fi

docker compose ps

# Les builds successifs laissent des images intermediaires derriere eux ; sans
# ce nettoyage le disque de la machine se remplit silencieusement.
echo "==> Nettoyage des images orphelines"
docker image prune --force --filter "until=168h" >/dev/null || true

echo "==> Deploiement ${DEPLOY_ENV} termine (${RELEASE_SHA})"
