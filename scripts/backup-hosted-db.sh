#!/usr/bin/env bash
# Read-only pg_dump of the intended hosted project. The password is entered privately.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
PROJECT_REF=yxzxctaobzxmrcvxuifc
OUT_DIR="$PWD/.sensibles-local/preprod-backup"
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

read -r -p 'Supabase host (direct or session pooler): ' PGHOST
read -r -p 'Supabase port: ' PGPORT
read -r -p 'Supabase database user: ' PGUSER
if [[ "$PGHOST $PGUSER" != *"$PROJECT_REF"* ]]; then
  echo 'REFUS: host/user ne correspond pas au projet Supabase attendu.' >&2
  exit 2
fi
[[ "$PGPORT" =~ ^[0-9]+$ ]] || { echo 'REFUS: port invalide.' >&2; exit 2; }
read -rs -p 'Supabase database password: ' PGPASSWORD
printf '\n'
export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE=postgres PGSSLMODE=require
trap 'unset PGPASSWORD' EXIT

STAMP=$(date +%Y%m%d-%H%M%S)
OUTPUT="$OUT_DIR/supabase-before-drive-$STAMP.dump"
docker run --rm --network host --user "$(id -u):$(id -g)" \
  -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGSSLMODE \
  -v "$OUT_DIR:/backup" postgres:17 sh -c \
  "umask 077; pg_dump --format=custom --no-owner --no-privileges --file=/backup/$(basename "$OUTPUT")"
unset PGPASSWORD
docker run --rm --network host --user "$(id -u):$(id -g)" \
  -v "$OUT_DIR:/backup:ro" postgres:17 pg_restore -l "/backup/$(basename "$OUTPUT")" >/dev/null
sha256sum "$OUTPUT" > "$OUTPUT.sha256"
echo "PASS: verified database archive at $OUTPUT (Storage photo objects require a separate export)"
