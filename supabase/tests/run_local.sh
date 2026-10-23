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

echo ">> stub Supabase + migrations 0001-0003"
for f in 00_stub_supabase.sql ../migrations/0001_schema.sql ../migrations/0002_functions.sql ../migrations/0003_rls_storage.sql; do
  $PSQL -f "$f" > /dev/null || { echo "ECHEC sur $f"; exit 2; }
done
echo ">> données d'avant 0004 (signalements à l'ancienne) puis migration 0004 : rien ne doit être perdu"
$PSQL > /dev/null <<'SQL'
insert into public.photos (id, audience, status, review_reason, full_path, thumb_path, original_sha256, uploader_id, published_at) values
 ('0a0a0a0a-0000-4000-8000-000000000001','public','hidden','reports','public/full/0a0a0a0a-0000-4000-8000-000000000001.jpg','public/thumbs/0a0a0a0a-0000-4000-8000-000000000001.jpg',repeat('1',64),gen_random_uuid(),now()),
 ('0a0a0a0a-0000-4000-8000-000000000002','public','published',null,'public/full/0a0a0a0a-0000-4000-8000-000000000002.jpg','public/thumbs/0a0a0a0a-0000-4000-8000-000000000002.jpg',repeat('2',64),gen_random_uuid(),now());
insert into public.photo_reports (photo_id, reporter_id, reason) values
 ('0a0a0a0a-0000-4000-8000-000000000001', gen_random_uuid(), 'embarrassing'),
 ('0a0a0a0a-0000-4000-8000-000000000001', gen_random_uuid(), 'child'),
 ('0a0a0a0a-0000-4000-8000-000000000002', gen_random_uuid(), 'other');
SQL
$PSQL -f ../migrations/0004_report_first_hides.sql > /dev/null || { echo "ECHEC sur 0004"; exit 2; }
KEPT=$(psql -X -qAt -c "select (select count(*) from public.photo_reports) || '/' || (select count(*) from public.photo_reports where resolved_at is null) || '/' || (select count(*) from public.photos where id::text like '0a0a0a0a%') || '/' || (select status from public.photos where id = '0a0a0a0a-0000-4000-8000-000000000001')")
if [ "$KEPT" = "3/3/2/hidden" ]; then echo "T30 | PASS | 0004 sur des données existantes : 3 signalements anciens conservés (motifs historiques valides), 2 photos intactes, photo masquée toujours masquée"; else echo "T30 | FAIL | $KEPT"; exit 2; fi
$PSQL -f ../migrations/0005_drive_sync.sql > /dev/null || { echo "ECHEC sur 0005"; exit 2; }
KEPT5=$(psql -X -qAt -c "select (select count(*) from public.photos where id::text like '0a0a0a0a%') || '/' || (select count(*) from public.photos where id::text like '0a0a0a0a%' and drive_sync_status = 'pending' and drive_file_id is null) || '/' || (select status from public.photos where id = '0a0a0a0a-0000-4000-8000-000000000001') || '/' || (select count(*) from public.photo_reports)")
if [ "$KEPT5" = "2/2/hidden/3" ]; then echo "T40 | PASS | 0005 sur des données existantes : 2 photos et 3 signalements intacts, photos anciennes en file 'pending', statut de modération inchangé"; else echo "T40 | FAIL | $KEPT5"; exit 2; fi
$PSQL -c "delete from public.photos where id::text like '0a0a0a0a%'" > /dev/null   # nettoyage de la base JETABLE avant les tests suivants
echo ">> migrations rejouées une 2e fois (idempotence)"
for f in ../migrations/0001_schema.sql ../migrations/0002_functions.sql ../migrations/0003_rls_storage.sql ../migrations/0004_report_first_hides.sql ../migrations/0005_drive_sync.sql; do
  $PSQL -f "$f" > /dev/null || { echo "ECHEC (non idempotent) sur $f"; exit 2; }
done

echo ">> tests SQL"
RES=$(mktemp)
trap 'rm -f "$RES"' EXIT
$PSQL -A -F ' | ' -f 10_tests.sql > "$RES" || { echo "FAIL: SQL assertions aborted"; exit 2; }
$PSQL -A -F ' | ' -f 20_drive_tests.sql >> "$RES" || { echo "FAIL: drive SQL assertions aborted"; exit 2; }
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
  for i in 1..10 loop
    v := gen_random_uuid();
    insert into public.photos (id, audience, status, full_path, thumb_path, original_sha256, uploader_id, published_at)
    values (v, 'public', 'published', 'public/full/'||v||'.jpg', 'public/thumbs/'||v||'.jpg', md5('race'||i)||md5('race'||i||'x'), gen_random_uuid(), now());
    insert into tc.race values (v, case when i <= 5 then 'distinct' else 'same' end);
  end loop;
end $$;
SQL
# Concurrence DÉTERMINISTE : la session A signale puis garde sa transaction ouverte 1,5 s (pg_sleep) ;
# pendant ce temps la session B signale la même photo. Sans verrou sur la ligne de la photo, B ne verrait pas
# le signalement de A (non validé) et pourrait créer un état incohérent.
#   'distinct' : deux navigateurs différents  => photo 'hidden' avec EXACTEMENT 2 signalements enregistrés
#   'same'     : même navigateur (double clic) => photo 'hidden' avec EXACTEMENT 1 signalement (le 2e = already_reported)
while read -r id kind; do
  RA=$(cat /proc/sys/kernel/random/uuid)
  if [ "$kind" = distinct ]; then RB=$(cat /proc/sys/kernel/random/uuid); else RB=$RA; fi
  ( psql -X -qAt -c "begin; set local role anon; select public.report_photo('$id','$RA','sexual'); select pg_sleep(1.5); commit;" </dev/null >/dev/null 2>&1 ) &
  ( sleep 0.5; psql -X -qAt -c "set role anon; select public.report_photo('$id','$RB','violence')" </dev/null >/dev/null 2>&1 ) &
done < <(psql -X -qAt -c "select id||' '||kind from tc.race")
wait   # (la boucle n'est pas dans un sous-shell : wait attend bien toutes les sessions)
BAD1=$(psql -X -qAt -c "select count(*) from public.photos p join tc.race r on r.id=p.id where r.kind='distinct' and (p.status <> 'hidden' or p.review_reason <> 'reports' or (select count(*) from public.photo_reports x where x.photo_id=p.id) <> 2)")
BAD2=$(psql -X -qAt -c "select count(*) from public.photos p join tc.race r on r.id=p.id where r.kind='same' and (p.status <> 'hidden' or p.review_reason <> 'reports' or (select count(*) from public.photo_reports x where x.photo_id=p.id) <> 1)")
if [ "$BAD1" = 0 ] && [ "$BAD2" = 0 ]; then
  echo "T12 | PASS | 5 photos x 2 signalements distincts simultanés => masquées avec 2 signalements ; 5 photos x double-clic => masquées avec 1 seul signalement"
else
  echo "T12 | FAIL | distinct incohérents=$BAD1, doubles-clics incohérents=$BAD2"; FAILS=$((FAILS+1))
fi

echo ">> T51 : double déclenchement de la synchronisation (2 sessions PostgreSQL simultanées)"
$PSQL > /dev/null <<'SQL'
delete from public.photos;
do $$ declare i int; v uuid; begin
  for i in 1..10 loop v := gen_random_uuid();
    insert into public.photos (id, audience, status, full_path, thumb_path, original_sha256, uploader_id, published_at, created_at)
    values (v, 'public', 'published', 'public/full/'||v||'.jpg', 'public/thumbs/'||v||'.jpg', md5('claim'||i)||md5('claim'||i||'x'), gen_random_uuid(), now(), now() + i * interval '1 second');
  end loop; end $$;
SQL
( psql -X -qAt -c "begin; set local role service_role; select count(*) from public.drive_claim(5); select pg_sleep(1.5); commit;" </dev/null >/dev/null 2>&1 ) &
( sleep 0.5; psql -X -qAt -c "set role service_role; select count(*) from public.drive_claim(5)" </dev/null >/dev/null 2>&1 ) &
wait
CLAIMED=$(psql -X -qAt -c "select count(*) || '/' || count(*) filter (where drive_sync_attempts = 1) from public.photos where drive_sync_status = 'processing'")
if [ "$CLAIMED" = "10/10" ]; then echo "T51 | PASS | 2 déclenchements simultanés : 10 photos réservées une seule fois chacune (aucune reprise en double)"; else echo "T51 | FAIL | $CLAIMED"; FAILS=$((FAILS+1)); fi

echo
if [ "${FAILS:-0}" -gt 0 ]; then echo "RÉSULTAT : $FAILS test(s) FAIL"; exit 1; fi
echo "RÉSULTAT : tous les tests SQL et de concurrence sont PASS (sur PostgreSQL local avec stub, PAS sur Supabase réel)"
