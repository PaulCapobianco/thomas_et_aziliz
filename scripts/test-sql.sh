#!/usr/bin/env bash
# Disposable local database only; no external connection is used.
set -euo pipefail
cd "$(dirname "$0")/.."
container="wedding-test-${RANDOM}-$$"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker run --rm -d --name "$container" -e POSTGRES_PASSWORD=local-test-only postgres:16 >/dev/null
ready=false
for attempt in {1..30}; do
  if docker exec -u postgres "$container" pg_isready -q; then ready=true; break; fi
  sleep 1
done
[ "$ready" = true ] || { echo 'FAIL: local PostgreSQL unavailable'; exit 2; }
docker cp supabase "$container":/tmp/supabase
docker exec -u postgres "$container" bash /tmp/supabase/tests/run_local.sh
docker exec -u postgres "$container" psql -X -q -v ON_ERROR_STOP=1 -d wedding_test \
  -f /tmp/supabase/optional/preflight_0005_drive_sync.sql >/dev/null
echo 'PASS: read-only Drive preflight SQL runs on the local test database'
