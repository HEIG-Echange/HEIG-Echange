#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Sauvegarde (export) de la base — dump SQL compresse, sans quitter Docker.
#
# Complement en ligne de commande de l'export graphique de phpMyAdmin : plus
# adapte a une sauvegarde automatisee ou avant un deploiement.
#
#   ./scripts/db-backup.sh                 -> backups/heig-echange-<horodatage>.sql.gz
#   ./scripts/db-restore.sh <fichier>      pour restaurer
#
# S'appuie sur le compose du dossier courant : lance mariadb-dump DANS le
# conteneur "db", donc aucun client MySQL n'a besoin d'etre installe sur l'hote.
# Le mot de passe est lu depuis .env (jamais passe en argument, qui serait
# visible dans la liste des processus).
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."

# Charge .env pour recuperer les identifiants de la base.
if [ -f .env ]; then
  set -a; . ./.env; set +a
fi

DB_NAME="${MARIADB_DATABASE:-heig_echange}"
DB_USER="${MARIADB_USER:-heig}"
DB_PASSWORD="${MARIADB_PASSWORD:?MARIADB_PASSWORD est requis (definir dans .env)}"

OUT_DIR="${BACKUP_DIR:-backups}"
mkdir -p "$OUT_DIR"

# Horodatage UTC, triable et sans caractere problematique pour un nom de fichier.
STAMP="$(date -u +%Y%m%d-%H%M%SZ)"
OUT_FILE="$OUT_DIR/${DB_NAME}-${STAMP}.sql.gz"

echo "==> Sauvegarde de '$DB_NAME' vers $OUT_FILE"

# -T : pas de pseudo-TTY, indispensable pour rediriger la sortie proprement.
# --single-transaction : dump coherent sans verrouiller les tables (InnoDB).
# MYSQL_PWD passe le mot de passe par l'environnement du conteneur, pas en argv.
docker compose exec -T \
  -e MYSQL_PWD="$DB_PASSWORD" \
  db mariadb-dump \
    --single-transaction \
    --quick \
    --default-character-set=utf8mb4 \
    -u "$DB_USER" \
    "$DB_NAME" \
  | gzip -c > "$OUT_FILE"

echo "==> Termine : $(du -h "$OUT_FILE" | cut -f1) ($OUT_FILE)"

