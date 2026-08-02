#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Restauration (import) de la base depuis un dump produit par db-backup.sh.
#
#   ./scripts/db-restore.sh backups/heig-echange-20260802-101500Z.sql.gz
#
# Accepte un fichier .sql ou .sql.gz. Operation DESTRUCTIVE : elle ecrase le
# contenu actuel de la base. Une confirmation est demandee, sauf si la variable
# FORCE=1 est definie (utile en automatisation).
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."

DUMP_FILE="${1:-}"
if [ -z "$DUMP_FILE" ] || [ ! -f "$DUMP_FILE" ]; then
  echo "usage: $0 <fichier .sql ou .sql.gz>" >&2
  exit 1
fi

if [ -f .env ]; then
  set -a; . ./.env; set +a
fi

DB_NAME="${MARIADB_DATABASE:-heig_echange}"
DB_USER="${MARIADB_USER:-heig}"
DB_PASSWORD="${MARIADB_PASSWORD:?MARIADB_PASSWORD est requis (definir dans .env)}"

if [ "${FORCE:-0}" != "1" ]; then
  echo "!! Cette operation va ECRASER la base '$DB_NAME' avec $DUMP_FILE."
  printf "   Confirmer ? [oui/N] "
  read -r reponse
  case "$reponse" in
    oui|OUI|o|O) ;;
    *) echo "Abandon."; exit 1 ;;
  esac
fi

echo "==> Restauration de '$DB_NAME' depuis $DUMP_FILE"

# Decompresse a la volee si necessaire, puis injecte dans le client mariadb du
# conteneur. -T : pas de pseudo-TTY, pour pouvoir alimenter stdin.
case "$DUMP_FILE" in
  *.gz) decompress() { gzip -dc "$DUMP_FILE"; } ;;
  *)    decompress() { cat "$DUMP_FILE"; } ;;
esac

decompress | docker compose exec -T \
  -e MYSQL_PWD="$DB_PASSWORD" \
  db mariadb \
    --default-character-set=utf8mb4 \
    -u "$DB_USER" \
    "$DB_NAME"

echo "==> Restauration terminee."

