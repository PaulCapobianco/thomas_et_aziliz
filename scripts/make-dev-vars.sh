#!/usr/bin/env bash
# Writes .dev.vars (Cloudflare local dev secrets) FROM THE ENVIRONMENT OF YOUR OWN TERMINAL.
# Never prints a value, never takes a value as an argument (so nothing lands in your shell history), mode 600,
# and refuses to overwrite an existing file. .dev.vars is git-ignored; check with:  git check-ignore -v .dev.vars
#
#   Variables to export first (see GUIDE_DRIVE.md, "saisie sécurisée") :
#     SUPABASE_URL SUPABASE_PUBLISHABLE_KEY SUPABASE_SERVICE_ROLE_KEY   <- TEST project only for local tests
#     GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REFRESH_TOKEN
#     DRIVE_FOLDER_PUBLIC DRIVE_FOLDER_PRIVATE                           <- TEST folders for local tests
#   SYNC_SECRET is generated here if absent. DRIVE_SYNC_ENABLED defaults to false (you enable it on purpose).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=.dev.vars
[ -e "$OUT" ] && { echo "REFUS: $OUT existe déjà (supprimez-le vous-même si vous voulez le recréer)."; exit 1; }
git check-ignore -q "$OUT" || { echo "REFUS: $OUT n'est pas ignoré par Git (vérifiez .gitignore)."; exit 1; }
missing=()
for v in SUPABASE_URL SUPABASE_PUBLISHABLE_KEY SUPABASE_SERVICE_ROLE_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REFRESH_TOKEN DRIVE_FOLDER_PUBLIC DRIVE_FOLDER_PRIVATE; do
  [ -n "${!v:-}" ] || missing+=("$v")
done
[ ${#missing[@]} -eq 0 ] || { echo "Variables absentes de CETTE session : ${missing[*]}"; exit 2; }
case "$SUPABASE_URL" in
  *yxzxctaobzxmrcvxuifc*) echo "REFUS: SUPABASE_URL est celle de la PRODUCTION. Utilisez un projet de test."; exit 3 ;;
esac
umask 077
{
  for v in SUPABASE_URL SUPABASE_PUBLISHABLE_KEY SUPABASE_SERVICE_ROLE_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REFRESH_TOKEN DRIVE_FOLDER_PUBLIC DRIVE_FOLDER_PRIVATE; do
    printf '%s=%s\n' "$v" "${!v}"
  done
  printf 'DRIVE_SYNC_ENABLED=%s\n' "${DRIVE_SYNC_ENABLED:-false}"
  printf 'SYNC_SECRET=%s\n' "${SYNC_SECRET:-$(openssl rand -hex 32)}"
} > "$OUT"
chmod 600 "$OUT"
echo "$OUT créé ($(wc -l < "$OUT") variables, mode 600, aucune valeur affichée)."
