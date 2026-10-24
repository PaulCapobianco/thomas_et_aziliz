#!/usr/bin/env bash
# Runs the REAL Google Drive checks from a local env file, printing no secret:
#   1. drive-verify-folders.mjs   (read-only: are the production folders private?)
#   2. drive-integration-test.mjs --google=live --with-docker-outage
#      (real Google Drive + the DISPOSABLE local Supabase stack; creates only a "TEST - Mariage (sync)" folder; deletes nothing)
#   bash scripts/drive-live-run.sh --check          validates the file only (nothing is run, nothing is printed but names)
#   bash scripts/drive-live-run.sh                  full run (default file: .env.drive-live.local)
#   bash scripts/drive-live-run.sh path/to/file     other file
# File format: NAME='value' (apostrophes recommended), one per line, mode 600, git-ignored. No `export` needed.
set -euo pipefail
cd "$(dirname "$0")/.."
CHECK=0; [ "${1:-}" = "--check" ] && { CHECK=1; shift; }
ENVF="${1:-.env.drive-live.local}"
NEEDED=(GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REFRESH_TOKEN DRIVE_FOLDER_PUBLIC DRIVE_FOLDER_PRIVATE)
[ -f "$ENVF" ] || { echo "ARRÊT: $ENVF introuvable."; exit 2; }
git check-ignore -q "$ENVF" || { echo "ARRÊT: $ENVF n'est pas ignoré par Git."; exit 2; }
[ "$(stat -c %a "$ENVF")" -le 600 ] || { echo "ARRÊT: droits trop larges sur $ENVF (faites: chmod 600 $ENVF)."; exit 2; }
empty=()
for v in "${NEEDED[@]}"; do
  val=$(grep -E "^(export +)?$v=" "$ENVF" | tail -1 | sed -E "s/^(export +)?$v=//; s/^['\"]//; s/['\"]\$//" || true)
  [ -n "$val" ] || empty+=("$v")
done
if [ ${#empty[@]} -gt 0 ]; then
  echo "ARRÊT: variables vides ou absentes dans $ENVF : ${empty[*]}"
  echo "→ ouvrez le fichier, remplissez les valeurs entre apostrophes, ENREGISTREZ, puis relancez."
  exit 3
fi
echo "Fichier $ENVF valide : ${#NEEDED[@]} variables renseignées (valeurs non affichées)."
[ $CHECK -eq 1 ] && exit 0
set -a; . "$ENVF"; set +a
# Never `kill 0` (that would signal the whole process group): only stop the proxy if it was really started.
cleanup() { [ -n "${PROXY:-}" ] && kill "$PROXY" 2>/dev/null || true; bash scripts/real-stack.sh down >/dev/null 2>&1 || true; }
trap cleanup EXIT
echo; echo "=== 1/2  Contrôle des dossiers de production (lecture seule)"
node scripts/drive-verify-folders.mjs
echo; echo "=== 2/2  Test réel complet : Google Drive RÉEL + pile Supabase locale jetable"
bash scripts/real-stack.sh up | tail -1
node scripts/real-stack-proxy.mjs & PROXY=$!
sleep 2
node scripts/drive-integration-test.mjs --google=live --with-docker-outage
