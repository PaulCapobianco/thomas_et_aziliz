-- =====================================================================
-- Tests SQL de 0005_drive_sync.sql. Exécuté APRÈS 10_tests.sql (réutilise le schéma d'aide `t`).
-- =====================================================================
\set ON_ERROR_STOP on
select coalesce(max(seq), 0) as base from t.results \gset

do $$
declare
  adm uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  usr uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  a uuid; b uuid; c uuid; m uuid; r text; n int; s text;
begin
  delete from public.photos;
  a := t.guest_register('public', 'drive-A', 'clean');          -- publiée
  b := t.guest_register('public', 'drive-B', 'suspect');        -- en attente (nsfw)
  m := t.guest_register('maries', 'drive-M', 'skipped');        -- privée
  c := t.guest_register('public', 'drive-C', 'clean');
  update public.photos set status = 'deleted' where id = c;     -- supprimée : ne doit jamais être transférée

  -- T41 : la synchronisation ne change ni la visibilité ni les statuts de modération
  perform set_config('request.jwt.claim.sub', '', true);
  set local role service_role;
  select count(*) into n from public.drive_claim(10);
  reset role;
  perform t.expect('T41', 'drive_claim prend les 3 photos non supprimées (publique, en attente, privée), pas la supprimée',
    n = 3 and (select drive_sync_status from public.photos where id = c) = 'pending', n::text);
  perform t.expect('T41b', 'statuts de modération inchangés après réservation',
    t.status_of(a) = 'published' and t.status_of(b) = 'pending_review/nsfw' and t.status_of(m) = 'published', t.status_of(a) || ' ' || t.status_of(b));

  -- T42 : une 2e exécution simultanée ne reprend pas les photos en cours (pas de doublon)
  set local role service_role;
  select count(*) into n from public.drive_claim(10);
  reset role;
  perform t.expect('T42', 'photos "processing" non reprises par une 2e exécution', n = 0, n::text);

  -- T43 : transfert vérifié -> transferred ; sans identifiant de fichier -> refusé
  set local role service_role;
  perform public.drive_mark_transferred(a, 'drive-id-A', 123456);
  reset role;
  perform t.expect('T43', 'transferred enregistre drive_file_id, taille et date',
    (select drive_sync_status = 'transferred' and drive_file_id = 'drive-id-A' and drive_bytes = 123456 and drive_synced_at is not null
       and drive_sync_error is null from public.photos where id = a));
  r := t.as_role('service_role', null, format($q$select public.drive_mark_transferred(%L, '', 1)::text$q$, b));
  perform t.expect('T43b', 'transferred sans identifiant Drive refusé', r like 'ERR:22023%', r);
  begin
    update public.photos set drive_sync_status = 'transferred', drive_file_id = null where id = b;
    perform t.expect('T43c', 'contrainte transferred => drive_file_id', false, 'aucune erreur');
  exception when check_violation then
    perform t.expect('T43c', 'contrainte transferred => drive_file_id', true);
  end;

  -- T44 : échec -> failed + erreur conservée ; la photo reste en place (aucune suppression)
  set local role service_role;
  perform public.drive_mark_failed(b, 'drive_503');
  reset role;
  perform t.expect('T44', 'failed conserve l''erreur', (select drive_sync_status = 'failed' and drive_sync_error = 'drive_503' from public.photos where id = b));

  -- T45 : une photo transferred ne repasse jamais en failed (réessai tardif)
  set local role service_role;
  perform public.drive_mark_failed(a, 'late');
  reset role;
  perform t.expect('T45', 'transferred protégé contre un échec tardif', (select drive_sync_status = 'transferred' from public.photos where id = a));

  -- T46 : délai avant nouvel essai, puis reprise automatique ; plafond de 6 essais
  set local role service_role;
  select count(*) into n from public.drive_claim(10);
  reset role;
  perform t.expect('T46', 'failed récent non repris immédiatement (délai croissant)', n = 0, n::text);
  update public.photos set drive_locked_at = now() - interval '1 hour' where id = b;
  set local role service_role;
  select count(*) into n from public.drive_claim(10);
  reset role;
  perform t.expect('T46b', 'failed repris après le délai', n = 1 and (select drive_sync_attempts from public.photos where id = b) = 2, n::text);
  update public.photos set drive_sync_status = 'failed', drive_sync_attempts = 6, drive_locked_at = now() - interval '1 day' where id = b;
  set local role service_role;
  select count(*) into n from public.drive_claim(10);
  reset role;
  perform t.expect('T46c', 'plus de reprise automatique après 6 essais', n = 0, n::text);

  -- T47 : traitement abandonné (> 10 min) repris ; drive_release rend la photo sans consommer d'essai
  update public.photos set drive_sync_status = 'processing', drive_locked_at = now() - interval '20 minutes', drive_sync_attempts = 1 where id = m;
  set local role service_role;
  select count(*) into n from public.drive_claim(10);
  perform public.drive_release(m);
  reset role;
  perform t.expect('T47', 'processing abandonné repris puis relâché sans consommer d''essai',
    n = 1 and (select drive_sync_status = 'pending' and drive_sync_attempts = 1 from public.photos where id = m));

  -- T48 : droits. Les invités et utilisateurs ordinaires n'appellent ni la file, ni les marqueurs, ni l'admin
  for s in select unnest(array[
      format($q$select count(*) from public.drive_claim(5)$q$),
      format($q$select public.drive_mark_transferred(%L, 'x', 1)::text$q$, b),
      format($q$select public.drive_mark_failed(%L, 'x')::text$q$, b),
      format($q$select public.drive_release(%L)::text$q$, b),
      $q$select public.admin_drive_status()::text$q$,
      $q$select public.admin_drive_retry(null)::text$q$])
  loop
    r := t.as_role('anon', null, s);
    perform t.expect('T48', 'anon refusé : ' || left(s, 45), r like 'ERR:42501%', r);
    r := t.as_role('authenticated', usr, s);
    perform t.expect('T48b', 'utilisateur non admin refusé : ' || left(s, 45), r like 'ERR:42501%', r);
  end loop;
  r := t.as_role('authenticated', adm, format($q$select count(*) from public.drive_claim(5)$q$));
  perform t.expect('T48c', 'l''admin connecté (rôle authenticated) n''a pas accès à la file serveur', r like 'ERR:42501%', r);

  -- T49 : colonnes Drive invisibles pour les invités (liste de colonnes de 0001 inchangée)
  r := t.as_role('anon', null, $q$select drive_file_id from public.photos limit 1$q$);
  perform t.expect('T49', 'drive_file_id illisible par anon', r like 'ERR:42501%', r);
  r := t.as_role('authenticated', usr, $q$select drive_sync_status from public.photos limit 1$q$);
  perform t.expect('T49b', 'drive_sync_status illisible par un utilisateur authentifié', r like 'ERR:42501%', r);

  -- T50 : admin : compteurs et relance des échecs
  update public.photos set drive_sync_status = 'failed', drive_sync_attempts = 6 where id = b;
  r := t.as_role('authenticated', adm, $q$select public.admin_drive_status()::text$q$);
  perform t.expect('T50', 'admin_drive_status : 1 transferred, 1 failed, 1 en attente, volume',
    r like 'OK:%' and (substr(r, 4)::jsonb) @> '{"transferred":1,"failed":1,"pending":1,"bytes":123456}', r);
  r := t.as_role('authenticated', adm, $q$select public.admin_drive_retry(null)::text$q$);
  perform t.expect('T50b', 'admin_drive_retry relance les échecs', r = 'OK:{"requeued": 1}'
    and (select drive_sync_status = 'pending' and drive_sync_attempts = 0 from public.photos where id = b), r);
end $$;

select id, case when ok then 'PASS' else 'FAIL' end as result, name, case when ok then '' else coalesce(detail, '') end as detail
  from t.results where seq > :base order by seq;
