#!/usr/bin/env bash
# =====================================================================
# Lance les migrations + les tests SQL + le test de concurrence sur un PostgreSQL LOCAL (jamais Supabase).
#
# Prérequis : un serveur PostgreSQL 14+ joignable et le client psql.
#   Option Docker :  docker run --rm -d --name pgtest -e POSTGRES_PASSWORD=pg -p 5433:5432 postgres:16
#                    PGHOST=localhost PGPORT=5433 PGUSER=postgres PGPASSWORD=pg ./run_local.sh
#   Option Supabase CLI locale (docker) : utilisez plutôt `supabase start` puis `supabase db reset`
#                    (dans ce cas le stub 00_stub_supabase.sql NE DOIT PAS être appliqué).
# Variables : PGHOST PGPORT PGUSER PGPASSWORD (standard psql). Base créée : wedding_test (recréée à chaque fois).
# Sortie : tableau PASS/FAIL ; code retour 1 si un seul FAIL.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")"
DB=wedding_test
export PGDATABASE=postgres
PSQL="psql -X -q -v ON_ERROR_STOP=1"

$PSQL -c "drop database if exists $DB" -c "create database $DB" || { echo "Connexion PostgreSQL impossible"; exit 2; }
export PGDATABASE=$DB

echo ">> stub Supabase + migrations"
for f in 00_stub_supabase.sql ../migrations/0001_schema.sql ../migrations/0002_functions.sql ../migrations/0003_rls_storage.sql; do
  $PSQL -f "$f" > /dev/null || { echo "ECHEC sur $f"; exit 2; }
done
echo ">> migrations rejouées une 2e fois (idempotence)"
for f in ../migrations/0001_schema.sql ../migrations/0002_functions.sql ../migrations/0003_rls_storage.sql; do
  $PSQL -f "$f" > /dev/null || { echo "ECHEC (non idempotent) sur $f"; exit 2; }
done

echo ">> tests SQL"
RES=$(mktemp)
trap 'rm -f "$RES"' EXIT
$PSQL -A -F ' | ' -f 10_tests.sql > "$RES" || { echo "FAIL: SQL assertions aborted"; exit 2; }
grep -E '^T[0-9]|^id ' "$RES" || true
FAILS=$(grep -c ' | FAIL | ' "$RES" || true)

echo ">> T12 : concurrence (signalements simultanés, vrais processus parallèles)"
$PSQL > /dev/null <<'SQL'
create schema if not exists tc;
drop table if exists tc.race; create table tc.race (id uuid, kind text);
do $$
declare i int; v uuid;
begin
  delete from public.photos;
  for i in 1..40 loop
    v := gen_random_uuid();
    insert into public.photos (id, audience, status, full_path, thumb_path, original_sha256, uploader_id, published_at)
    values (v, 'public', 'published', 'public/full/'||v||'.jpg', 'public/thumbs/'||v||'.jpg', md5('race'||i)||md5('race'||i||'x'), gen_random_uuid(), now());
    insert into tc.race values (v, case when i <= 20 then 'distinct' else 'same' end);
  end loop;
end $$;
SQL
# Concurrence DÉTERMINISTE : la session A signale puis garde sa transaction ouverte 1,5 s (pg_sleep) ;
# pendant ce temps la session B signale la même photo. Sans verrou sur la ligne de la photo, B ne voit pas
# le vote de A (non validé) et la photo resterait visible avec 2 votes : le test échoue alors à coup sûr.
#   'distinct' : deux navigateurs différents  => doit finir 'hidden' avec 2 votes
#   'same'     : même navigateur (double clic) => doit rester 'published' avec 1 vote
while read -r id kind; do
  if [ "$kind" = distinct ]; then RB=22222222-2222-2222-2222-222222222222; RA=11111111-1111-1111-1111-111111111111
  else RB=33333333-3333-3333-3333-333333333333; RA=33333333-3333-3333-3333-333333333333; fi
  ( psql -X -qAt -c "begin; set local role anon; select public.report_photo('$id','$RA'); select pg_sleep(1.5); commit;" </dev/null >/dev/null 2>&1 ) &
  ( sleep 0.5; psql -X -qAt -c "set role anon; select public.report_photo('$id','$RB')" </dev/null >/dev/null 2>&1 ) &
done < <(psql -X -qAt -c "select id||' '||kind from tc.race")
wait   # (la boucle n'est pas dans un sous-shell : wait attend bien toutes les sessions)
BAD1=$(psql -X -qAt -c "select count(*) from public.photos p join tc.race r on r.id=p.id where r.kind='distinct' and (p.status <> 'hidden' or (select count(*) from public.photo_reports x where x.photo_id=p.id) <> 2)")
BAD2=$(psql -X -qAt -c "select count(*) from public.photos p join tc.race r on r.id=p.id where r.kind='same' and (p.status <> 'published' or (select count(*) from public.photo_reports x where x.photo_id=p.id) <> 1)")
if [ "$BAD1" = 0 ] && [ "$BAD2" = 0 ]; then
  echo "T12 | PASS | 20 photos x 2 votes distincts simultanés => toutes masquées (2 votes) ; 20 photos x double-clic => 1 vote, visibles"
else
  echo "T12 | FAIL | distinct incohérents=$BAD1, doubles-clics incohérents=$BAD2"; FAILS=$((FAILS+1))
fi

echo
if [ "${FAILS:-0}" -gt 0 ]; then echo "RÉSULTAT : $FAILS test(s) FAIL"; exit 1; fi
echo "RÉSULTAT : tous les tests SQL et de concurrence sont PASS (sur PostgreSQL local avec stub, PAS sur Supabase réel)"
