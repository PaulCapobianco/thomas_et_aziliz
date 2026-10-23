#!/usr/bin/env bash
# Disposable REAL stack on localhost: PostgreSQL 16 + the official Supabase Storage API image + PostgREST,
# with the project migrations applied. No Supabase account, no cost, nothing leaves the machine.
# Differences with hosted Supabase (not replicated): GoTrue (admin sign-in is simulated with signed JWTs),
# Kong/CDN, quotas. Storage RLS, signed URLs, size/mime limits and RPC permissions are the real components.
#   bash scripts/real-stack.sh up      start the stack (images are pulled the first time)
#   bash scripts/real-stack.sh test    HTTP security test + real browser flow on Chromium/Pixel/WebKit
#   bash scripts/real-stack.sh down    remove containers and the temporary directory
set -euo pipefail
cd "$(dirname "$0")/.."
STATE=.real-stack            # git-ignored: holds the throwaway JWT secret and keys
SECRET=local-only-secret-local-only-secret-1234
STORAGE_IMAGE=supabase/storage-api:v1.14.6
REST_IMAGE=postgrest/postgrest:v12.2.3
AUTH_IMAGE=supabase/gotrue:v2.158.1
ADMIN_PASSWORD='Admin-test-only-123'   # throwaway accounts of the disposable stack
docker_ps() { docker exec -u postgres wreal-pg psql -q -v ON_ERROR_STOP=1 -d wedding_real "$@"; }

jwt() { # role [sub]
  JWT_SECRET="$SECRET" node -e '
    const c=require("node:crypto"),b=x=>Buffer.from(JSON.stringify(x)).toString("base64url");
    const [role,sub]=process.argv.slice(1);
    const h=b({alg:"HS256",typ:"JWT"}),p=b({role,...(sub?{sub,aud:"authenticated"}:{}),iss:"supabase",exp:Math.floor(Date.now()/1000)+864000});
    process.stdout.write(`${h}.${p}.${c.createHmac("sha256",process.env.JWT_SECRET).update(h+"."+p).digest("base64url")}`)' "$@"
}

up() {
  down >/dev/null 2>&1 || true
  mkdir -p "$STATE"
  docker network create wreal >/dev/null
  docker run -d --rm --name wreal-pg --network wreal -e POSTGRES_PASSWORD=pg postgres:16 >/dev/null
  for _ in $(seq 1 40); do docker exec -u postgres wreal-pg pg_isready -q && break; sleep 1; done
  docker exec -u postgres wreal-pg psql -qc "create database wedding_real"
  docker cp supabase wreal-pg:/tmp/supabase
  docker_ps -f /tmp/supabase/tests/real_bootstrap.sql
  ANON=$(jwt anon); SERVICE=$(jwt service_role)
  echo "$ANON" > "$STATE/anon.key"; echo "$SERVICE" > "$STATE/service.key"
  jwt authenticated aaaaaaaa-0000-0000-0000-000000000001 > "$STATE/admin.key"
  jwt authenticated bbbbbbbb-0000-0000-0000-000000000002 > "$STATE/user.key"
  docker run -d --rm --name wreal-st --network wreal -p 127.0.0.1:5055:5000 \
    -e ANON_KEY="$ANON" -e SERVICE_KEY="$SERVICE" -e AUTH_JWT_SECRET="$SECRET" -e PGRST_JWT_SECRET="$SECRET" \
    -e DATABASE_URL=postgres://supabase_storage_admin:pw@wreal-pg:5432/wedding_real \
    -e DB_INSTALL_ROLES=false -e STORAGE_BACKEND=file -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage \
    -e FILE_SIZE_LIMIT=52428800 -e TENANT_ID=stub -e REGION=stub -e GLOBAL_S3_BUCKET=stub \
    -e POSTGREST_URL=http://nowhere:3000 -e SERVER_PORT=5000 -e MULTI_TENANT=false "$STORAGE_IMAGE" >/dev/null
  docker run -d --rm --name wreal-auth --network wreal -p 127.0.0.1:5058:9999 \
    -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 -e PORT=9999 -e GOTRUE_DB_DRIVER=postgres \
    -e GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:pw@wreal-pg:5432/wedding_real \
    -e GOTRUE_SITE_URL=http://127.0.0.1:5057 -e API_EXTERNAL_URL=http://127.0.0.1:5057 \
    -e GOTRUE_JWT_SECRET="$SECRET" -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_AUD=authenticated \
    -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated -e GOTRUE_DISABLE_SIGNUP=true \
    -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=false "$AUTH_IMAGE" >/dev/null
  for _ in $(seq 1 90); do
    [ "$(docker_ps -Atc "select to_regclass('storage.objects') is not null and to_regclass('auth.users') is not null and to_regclass('auth.identities') is not null" 2>/dev/null)" = t ] && break; sleep 1
  done
  sleep 3
  for f in 0001_schema 0002_functions 0003_rls_storage 0004_report_first_hides 0005_drive_sync; do docker_ps -f "/tmp/supabase/migrations/$f.sql" >/dev/null 2>&1; done
  docker_ps -f /tmp/supabase/tests/real_after_storage.sql >/dev/null
  # Real accounts through the GoTrue admin API (email already confirmed, as with "Auto Confirm User").
  for who in "aaaaaaaa-0000-0000-0000-000000000001 admin@example.test" "bbbbbbbb-0000-0000-0000-000000000002 invite@example.test"; do
    set -- $who
    curl -sf -X POST http://127.0.0.1:5058/admin/users -H "Authorization: Bearer $SERVICE" -H "Content-Type: application/json" \
      -d "{\"id\":\"$1\",\"email\":\"$2\",\"password\":\"$ADMIN_PASSWORD\",\"email_confirm\":true}" >/dev/null
  done
  docker_ps -c "insert into public.admin_users (user_id) select id from auth.users where email = 'admin@example.test' on conflict do nothing" >/dev/null
  docker run -d --rm --name wreal-rest --network wreal -p 127.0.0.1:5056:3000 \
    -e PGRST_DB_URI=postgres://authenticator:pw@wreal-pg:5432/wedding_real -e PGRST_DB_SCHEMAS=public \
    -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRET" "$REST_IMAGE" >/dev/null
  sleep 3
  echo "stack ready: storage :5055, rest :5056, auth :5058 (proxy :5057 is started by 'test')"
}

down() {
  docker rm -f wreal-pg wreal-st wreal-rest wreal-auth >/dev/null 2>&1 || true
  docker network rm wreal >/dev/null 2>&1 || true
  rm -rf "$STATE"
}

run_tests() {
  [ -f "$STATE/anon.key" ] || { echo "stack not running: bash scripts/real-stack.sh up"; exit 2; }
  export REAL_URL=http://127.0.0.1:5057 REAL_ANON; REAL_ANON=$(cat "$STATE/anon.key")
  export REAL_ADMIN_JWT; REAL_ADMIN_JWT=$(cat "$STATE/admin.key")
  export REAL_USER_JWT; REAL_USER_JWT=$(cat "$STATE/user.key")
  export REAL_ADMIN_PASSWORD="$ADMIN_PASSWORD"
  export REAL_SERVICE_KEY; REAL_SERVICE_KEY=$(cat "$STATE/service.key")
  python3 scripts/serve.py --port 4173 & SERVE=$!
  node scripts/real-stack-proxy.mjs & PROXY=$!
  trap 'kill $SERVE $PROXY 2>/dev/null || true' EXIT
  sleep 2
  rc=0
  node scripts/real-http-test.mjs || rc=1
  # The HTTP test exercises the global report flood guard (12 photos / 10 min): age its reports so the browser tests start clean.
  docker exec -u postgres wreal-pg psql -q -d wedding_real -c "update public.photo_reports set created_at = created_at - interval '2 hours'" >/dev/null
  PLAYWRIGHT_REUSE=1 npx playwright test tests/real-stack.spec.js tests/real-admin.spec.js --workers=1 --reporter=line || rc=1
  exit $rc
}

case "${1:-}" in
  up) up ;;
  test) run_tests ;;
  down) down ;;
  *) echo "usage: $0 up|test|down"; exit 2 ;;
esac
