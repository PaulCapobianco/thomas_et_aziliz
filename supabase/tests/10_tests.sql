-- =====================================================================
-- Tests SQL (RLS, fonctions, droits). Exécutés par run_local.sh sur la base de test.
-- Chaque test écrit PASS/FAIL dans t.results. Les tests de concurrence (T12) sont dans run_local.sh.
-- =====================================================================
\set ON_ERROR_STOP on

drop schema if exists t cascade;
create schema t;
create table t.results (seq serial, id text, name text, ok boolean, detail text);

create function t.expect(p_id text, p_name text, p_ok boolean, p_detail text default null) returns void
language sql as $$ insert into t.results (id, name, ok, detail) values (p_id, p_name, coalesce(p_ok, false), p_detail) $$;

-- Exécute une requête scalaire (renvoyée en texte) avec un rôle et un uid donnés.
-- Renvoie 'OK:<valeur>' ou 'ERR:<sqlstate>:<message>'.
create function t.as_role(p_role text, p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into r;
    reset role;
    return 'OK:' || coalesce(r, '');
  exception when others then
    reset role;
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
end $$;

-- Simule l'upload réussi des deux fichiers (comme le ferait l'API Storage : métadonnées size + mimetype)
create function t.put_objects(p_aud text, p_id uuid, p_size bigint default 300000, p_age interval default '0') returns void
language sql as $$
  insert into storage.objects (bucket_id, name, metadata, created_at) values
    ('photos', p_aud || '/full/'   || p_id::text || '.jpg', jsonb_build_object('size', p_size, 'mimetype', 'image/jpeg'), now() - p_age),
    ('photos', p_aud || '/thumbs/' || p_id::text || '.jpg', jsonb_build_object('size', 30000, 'mimetype', 'image/jpeg'), now() - p_age)
$$;

create function t.sha(p_seed text) returns text language sql immutable as $$ select md5(p_seed) || md5(p_seed || 'x') $$;

-- Enregistre une photo comme un invité (rôle anon) : renvoie le résultat jsonb->>'result'
create function t.guest_register(p_aud text, p_seed text, p_nsfw text, p_uploader uuid default '00000000-0000-0000-0000-0000000000a1')
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); v_res text;
begin
  perform t.put_objects(p_aud, v_id);
  v_res := t.as_role('anon', null, format($q$select public.register_photo(%L, %L, %L, %L, %L)->>'result'$q$,
                                         v_id, p_aud, t.sha(p_seed), p_uploader, p_nsfw));
  if v_res like 'ERR:%' then raise exception 'register failed: %', v_res; end if;
  return v_id;
end $$;

create function t.status_of(p_id uuid) returns text language sql as $$ select status || coalesce('/' || review_reason, '') from public.photos where id = p_id $$;

-- Comptes : un admin et un utilisateur authentifié ordinaire
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'admin@example.test'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'invite@example.test');
insert into public.admin_users (user_id) values ('aaaaaaaa-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------- T03 / T04 / T05 : envoi, doublons
do $$
declare a uuid; b uuid; c uuid; r text; res text;
begin
  a := t.guest_register('public', 'photo-A', 'clean');
  perform t.expect('T03', 'envoi public vérifié => published', t.status_of(a) = 'published', t.status_of(a));
  res := t.as_role('anon', null, $q$select count(*) from public.gallery_page(48)$q$);
  perform t.expect('T03b', 'la photo apparaît dans gallery_page (anon)', res = 'OK:1', res);

  -- même fichier, même destination => doublon
  b := gen_random_uuid(); perform t.put_objects('public', b);
  r := t.as_role('anon', null, format($q$select public.register_photo(%L,'public',%L,'00000000-0000-0000-0000-0000000000a1','clean')->>'result'$q$, b, t.sha('photo-A')));
  perform t.expect('T04', 'même fichier exact, même destination => duplicate', r = 'OK:duplicate', r);
  perform t.expect('T04b', 'aucune 2e ligne créée', (select count(*) from public.photos where original_sha256 = t.sha('photo-A')) = 1);

  -- même fichier mais destination différente => autorisé
  c := t.guest_register('maries', 'photo-A', 'skipped');
  perform t.expect('T04c', 'même fichier en destination mariés => accepté', t.status_of(c) = 'published');

  -- photos similaires mais différentes => toutes gardées
  perform t.guest_register('public', 'photo-A-bis', 'clean');
  perform t.guest_register('public', 'photo-A-ter', 'clean');
  perform t.expect('T05', 'photos similaires (empreintes différentes) toutes conservées',
    (select count(*) from public.photos where audience = 'public' and status = 'published') = 3);

  -- check_duplicates
  r := t.as_role('anon', null, format($q$select cardinality(public.check_duplicates('public', array[%L, %L]))$q$, t.sha('photo-A'), t.sha('inconnue')));
  perform t.expect('T25', 'check_duplicates ne renvoie que les empreintes présentes', r = 'OK:1', r);
  r := t.as_role('anon', null, format($q$select cardinality(public.check_duplicates('maries', array[%L]))$q$, t.sha('photo-A-bis')));
  perform t.expect('T25b', 'check_duplicates est propre à la destination', r = 'OK:0', r);
end $$;

-- ---------------------------------------------------------------- T06 : confidentialité des photos privées
do $$
declare m uuid; r text;
begin
  m := (select id from public.photos where audience = 'maries' limit 1);
  r := t.as_role('anon', null, $q$select count(*) from public.gallery_page(100) where full_path like 'maries/%'$q$);
  perform t.expect('T06', 'gallery_page ne renvoie aucune photo privée', r = 'OK:0', r);
  r := t.as_role('anon', null, $q$select count(*) from public.photos where audience = 'maries'$q$);
  perform t.expect('T06b', 'SELECT direct sur photos : aucune ligne privée visible', r = 'OK:0', r);
  r := t.as_role('anon', null, $q$select count(*) from storage.objects where name like 'maries/%'$q$);
  perform t.expect('T06c', 'storage.objects : aucun objet privé lisible par anon', r = 'OK:0', r);
  r := t.as_role('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002', $q$select count(*) from storage.objects where name like 'maries/%'$q$);
  perform t.expect('T06d', 'utilisateur connecté NON admin : aucun objet privé lisible', r = 'OK:0', r);
end $$;

-- ---------------------------------------------------------------- T07 / T08 : NSFW et modèle indisponible
do $$
declare s uuid; u uuid; k uuid; ok_ uuid; r text;
begin
  s := t.guest_register('public', 'suspecte', 'suspect');
  perform t.expect('T07', 'photo suspecte => pending_review/nsfw', t.status_of(s) = 'pending_review/nsfw', t.status_of(s));
  r := t.as_role('anon', null, format($q$select count(*) from public.gallery_page(100) where id = %L$q$, s));
  perform t.expect('T07b', 'photo suspecte absente de la galerie', r = 'OK:0', r);
  r := t.as_role('anon', null, format($q$select count(*) from storage.objects where name like %L$q$, 'public/%/' || s::text || '.jpg'));
  perform t.expect('T07c', 'fichiers de la photo suspecte illisibles par anon', r = 'OK:0', r);
  perform t.expect('T07d', 'photo suspecte conservée (fichiers présents)',
    (select count(*) from storage.objects where name like 'public/%/' || s::text || '.jpg') = 2);

  u := t.guest_register('public', 'modele-ko', 'unavailable');
  perform t.expect('T08', 'modèle indisponible => pending_review/model_unavailable', t.status_of(u) = 'pending_review/model_unavailable', t.status_of(u));
  k := t.guest_register('public', 'public-skipped', 'skipped');
  perform t.expect('T08b', '"skipped" sur une photo PUBLIQUE ne la publie jamais', t.status_of(k) = 'pending_review/model_unavailable', t.status_of(k));
  ok_ := t.guest_register('maries', 'prive-sans-modele', 'skipped');
  perform t.expect('T08c', 'envoi privé sans modèle IA => accepté', t.status_of(ok_) = 'published');
end $$;

-- ---------------------------------------------------------------- T09 / T10 / T11 / T15 / T21 : signalements (1 seul signalement masque)
do $$
declare p uuid; q uuid; r text; ra uuid := '11111111-1111-1111-1111-111111111111'; rb uuid := '22222222-2222-2222-2222-222222222222';
        adm uuid := 'aaaaaaaa-0000-0000-0000-000000000001'; n int;
begin
  p := t.guest_register('public', 'a-signaler', 'clean');
  -- Validation des entrées côté serveur
  r := t.as_role('anon', null, format($q$select public.report_photo(%L, %L, null)->>'result'$q$, p, ra));
  perform t.expect('T09a', 'signalement sans motif => refusé (22023)', r like 'ERR:22023%', r);
  r := t.as_role('anon', null, format($q$select public.report_photo(%L, %L, 'embarrassing')->>'result'$q$, p, ra));
  perform t.expect('T09a2', 'ancien motif / motif inconnu => refusé (22023)', r like 'ERR:22023%', r);
  r := t.as_role('anon', null, format($q$select public.report_photo(%L, %L, 'other')->>'result'$q$, p, ra));
  perform t.expect('T09b0', '« other » sans description => refusé (comment_required)', r like 'ERR:22023%comment_required%', r);
  r := t.as_role('anon', null, format($q$select public.report_photo(%L, %L, 'other', '  ab ')->>'result'$q$, p, ra));
  perform t.expect('T09b1', '« other » avec description trop courte => refusé', r like 'ERR:22023%comment_required%', r);
  r := t.as_role('anon', null, format($q$select public.report_photo(%L, %L, 'sexual', %L)->>'result'$q$, p, ra, repeat('x', 501)));
  perform t.expect('T09b2', 'commentaire > 500 caractères => refusé', r like 'ERR:22023%comment_too_long%', r);
  perform t.expect('T09b3', 'les refus n''ont ni masqué ni enregistré',
    t.status_of(p) = 'published' and (select count(*) from public.photo_reports where photo_id = p) = 0, t.status_of(p));

  -- 1er signalement valide : masquage immédiat, atomique
  r := t.as_role('anon', null, format($q$select public.report_photo(%L, %L, 'sexual', 'objet inapproprié')->>'result'$q$, p, ra));
  perform t.expect('T09', 'premier signalement valide => reported', r = 'OK:reported', r);
  perform t.expect('T09c', 'photo masquée immédiatement (hidden / reports)', t.status_of(p) = 'hidden/reports', t.status_of(p));
  perform t.expect('T09d', 'motif et commentaire enregistrés',
    (select reason || '|' || comment from public.photo_reports where photo_id = p) = 'sexual|objet inapproprié');
  r := t.as_role('anon', null, format($q$select count(*) from public.gallery_page(100) where id = %L$q$, p));
  perform t.expect('T11b', 'photo masquée absente de la galerie', r = 'OK:0', r);
  perform t.expect('T11c', 'photo masquée non supprimée (ligne + 2 fichiers conservés)',
    (select count(*) from public.photos where id = p) = 1 and (select count(*) from storage.objects where name like 'public/%/' || p::text || '.jpg') = 2);
  r := t.as_role('anon', null, format($q$select count(*) from storage.objects where name like %L$q$, 'public/%/' || p::text || '.jpg'));
  perform t.expect('T11d', 'photo masquée : fichiers illisibles par anon (plus de nouvelle URL signée)', r = 'OK:0', r);
  r := t.as_role('anon', null, format($q$select count(*) from public.photos where id = %L$q$, p));
  perform t.expect('T11e', 'photo masquée absente de la lecture directe de la table', r = 'OK:0', r);

  -- Doublon, puis second navigateur (la photo reste masquée, le signalement est enregistré)
  r := t.as_role('anon', null, format($q$select public.report_photo(%L, %L, 'sexual')->>'result'$q$, p, ra));
  perform t.expect('T10', 'même navigateur, signalement encore ouvert => already_reported', r = 'OK:already_reported', r);
  r := t.as_role('anon', null, format($q$select public.report_photo(%L, %L, 'violence')->>'result'$q$, p, rb));
  perform t.expect('T10b', 'second navigateur sur une photo déjà masquée => reported (2 signalements conservés)',
    r = 'OK:reported' and t.status_of(p) = 'hidden/reports' and (select count(*) from public.photo_reports where photo_id = p) = 2, r);

  -- L'administration voit le motif, le commentaire, le total
  r := t.as_role('authenticated', adm, format($q$select (x.report_count || '/' || x.open_reports || '/' || x.status || '/' ||
      (select string_agg(e ->> 'reason', ',' order by e ->> 'reason') from jsonb_array_elements(x.reports) e) || '/' || (x.reports -> 0 ->> 'comment' is not null or x.reports -> 1 ->> 'comment' is not null)::text)
      from public.admin_list_photos('reported', 50, 0) x where x.id = %L$q$, p));
  perform t.expect('T11f', 'admin_list_photos(reported) : total, ouverts, statut, motifs, commentaire', r = 'OK:2/2/hidden/sexual,violence/true', r);
  r := t.as_role('authenticated', adm, $q$select (public.admin_status() ->> 'reported')$q$);
  perform t.expect('T11g', 'admin_status().reported compte les photos à examiner', r = 'OK:1', r);

  -- T15 : restauration admin => signalements conservés mais résolus, pas de remasquage
  r := t.as_role('authenticated', adm, format($q$select public.admin_set_status(%L, 'published')->>'result'$q$, p));
  perform t.expect('T15', 'admin restaure la photo signalée', r = 'OK:published' and t.status_of(p) = 'published', r);
  perform t.expect('T15b', 'restauration : signalements CONSERVÉS et résolus (trace)',
    (select count(*) from public.photo_reports where photo_id = p and resolution = 'restored' and resolved_at is not null) = 2);
  perform t.expect('T15d', 'décision tracée dans photo_moderation', (select action from public.photo_moderation where photo_id = p) = 'restored');
  perform t.expect('T15e', 'photo restaurée de nouveau dans la galerie', (select count(*) from public.gallery_page(100) where id = p) = 1);
  r := t.as_role('authenticated', adm, format($q$select count(*) from public.admin_list_photos('reported', 50, 0) x where x.id = %L$q$, p));
  perform t.expect('T15f', 'photo restaurée : plus dans les éléments à examiner', r = 'OK:0', r);
  -- un ancien signalement ne remasque rien (aucun mécanisme de comptage) ; un NOUVEAU signalement valide remasque
  perform t.expect('T15c', 'après restauration, rien ne remasque tout seul', t.status_of(p) = 'published');
  r := t.as_role('anon', null, format($q$select public.report_photo(%L, %L, 'privacy', 'on me voit de face')->>'result'$q$, p, ra));
  perform t.expect('T15g', 'nouveau signalement valide après restauration => masquée à nouveau',
    r = 'OK:reported' and t.status_of(p) = 'hidden/reports', r || ' ' || t.status_of(p));
  select count(*) into n from public.photo_reports where photo_id = p and reporter_id = ra;
  perform t.expect('T15h', 'même navigateur : au plus 3 signalements par photo (anciens inclus)', n = 2, n::text);
  -- maintenir masquée / supprimer : comportement existant
  r := t.as_role('authenticated', adm, format($q$select public.admin_set_status(%L, 'hidden')->>'result'$q$, p));
  perform t.expect('T15i', 'admin maintient masquée : hidden/admin, signalements résolus kept_hidden',
    r = 'OK:hidden' and t.status_of(p) = 'hidden/admin' and (select count(*) from public.photo_reports where photo_id = p and resolution = 'kept_hidden') = 1, t.status_of(p));
  r := t.as_role('anon', null, format($q$select public.report_photo(%L, %L, 'violence')->>'result'$q$, p, gen_random_uuid()));
  perform t.expect('T15j', 'photo masquée par un admin : signalement ignoré (not_found)', r = 'OK:not_found', r);

  -- T21 : on ne signale pas une photo privée ni en attente
  q := (select id from public.photos where audience = 'maries' limit 1);
  r := t.as_role('anon', null, format($q$select public.report_photo(%L, %L, 'sexual')->>'result'$q$, q, ra));
  perform t.expect('T21', 'signaler une photo privée => not_found', r = 'OK:not_found', r);
  q := (select id from public.photos where status = 'pending_review' limit 1);
  r := t.as_role('anon', null, format($q$select public.report_photo(%L, %L, 'sexual')->>'result'$q$, q, ra));
  perform t.expect('T21b', 'signaler une photo en attente => not_found', r = 'OK:not_found', r);
  r := t.as_role('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002', format($q$select public.admin_set_status(%L, 'published')->>'result'$q$, p));
  perform t.expect('T21c', 'un invité (compte non admin) ne peut pas restaurer', r like 'ERR:42501%', r);
end $$;

-- ---------------------------------------------------------------- T13 / T14 : droits admin, pause, relâche
do $$
declare r text; adm uuid := 'aaaaaaaa-0000-0000-0000-000000000001'; usr uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
        p1 uuid; p2 uuid; p3 uuid; m uuid;
begin
  r := t.as_role('anon', null, $q$select public.admin_status()::text$q$);
  perform t.expect('T13', 'anon ne peut pas appeler admin_status', r like 'ERR:42501%', r);
  r := t.as_role('authenticated', usr, $q$select public.admin_status()::text$q$);
  perform t.expect('T13b', 'utilisateur connecté non admin : admin_status refusé', r like 'ERR:42501%', r);
  r := t.as_role('authenticated', adm, $q$select (public.admin_status()->>'published')$q$);
  perform t.expect('T13c', 'compte admin : admin_status OK', r like 'OK:%', r);
  r := t.as_role('authenticated', usr, $q$select count(*) from public.admin_list_photos('maries')$q$);
  perform t.expect('T13d', 'non admin : admin_list_photos refusé', r like 'ERR:42501%', r);

  -- pause
  r := t.as_role('authenticated', adm, $q$select public.admin_set_paused(true)->>'paused'$q$);
  perform t.expect('T14', 'admin met en pause', r = 'OK:true', r);
  perform t.expect('T14b', 'la pause est persistée en base', (select (value)::boolean from public.app_settings where key = 'publications_paused'));
  p1 := t.guest_register('public', 'pause-1', 'clean');
  p2 := t.guest_register('public', 'pause-2', 'suspect');
  m  := t.guest_register('maries', 'pause-prive', 'skipped');
  perform t.expect('T14c', 'pause : nouvelle photo publique => pending_review/paused', t.status_of(p1) = 'pending_review/paused', t.status_of(p1));
  perform t.expect('T14d', 'pause : une photo suspecte reste "nsfw" (la pause ne masque pas la suspicion)', t.status_of(p2) = 'pending_review/nsfw', t.status_of(p2));
  perform t.expect('T14e', 'pause : l''envoi privé aux mariés continue', t.status_of(m) = 'published');
  perform t.expect('T14f', 'pause : la galerie existante reste consultable',
    (select count(*) from public.photos where audience = 'public' and status = 'published') > 0);

  -- reprise + relâche : ne publie jamais les photos suspectes
  perform t.as_role('authenticated', adm, $q$select public.admin_set_paused(false)->>'paused'$q$);
  r := t.as_role('authenticated', adm, $q$select public.admin_release_pending('paused')->>'released'$q$);
  perform t.expect('T14g', 'reprise : admin_release_pending(''paused'') publie les photos mises en attente par la pause', t.status_of(p1) = 'published', r);
  perform t.expect('T14h', 'reprise : la photo suspecte reste en attente', t.status_of(p2) = 'pending_review/nsfw', t.status_of(p2));
  r := t.as_role('authenticated', adm, $q$select public.admin_release_pending('nsfw')->>'released'$q$);
  perform t.expect('T14i', 'admin_release_pending(''nsfw'') est refusé', r like 'ERR:22023%', r);

  -- masquer / restaurer
  r := t.as_role('authenticated', adm, format($q$select public.admin_set_status(%L, 'hidden')->>'result'$q$, p1));
  perform t.expect('T14j', 'admin masque une photo', t.status_of(p1) = 'hidden/admin', t.status_of(p1));
  r := t.as_role('authenticated', adm, format($q$select public.admin_set_status(%L, 'published')->>'result'$q$, p1));
  perform t.expect('T14k', 'admin restaure une photo', t.status_of(p1) = 'published', t.status_of(p1));
  r := t.as_role('authenticated', adm, format($q$select public.admin_set_status(%L, 'published')->>'result'$q$, p2));
  perform t.expect('T14l', 'admin peut publier UNE photo suspecte après examen', t.status_of(p2) = 'published', t.status_of(p2));
end $$;

-- ---------------------------------------------------------------- T16 : envoi interrompu / objets invalides
do $$
declare id1 uuid := gen_random_uuid(); id2 uuid := gen_random_uuid(); id3 uuid := gen_random_uuid(); r text;
begin
  insert into storage.objects (bucket_id, name, metadata)
    values ('photos', 'public/full/' || id1::text || '.jpg', '{"size":300000,"mimetype":"image/jpeg"}');   -- la miniature manque
  r := t.as_role('anon', null, format($q$select public.register_photo(%L,'public',%L,'00000000-0000-0000-0000-0000000000a1','clean')->>'result'$q$, id1, t.sha('partielle')));
  perform t.expect('T16', 'miniature manquante => erreur, rien de publié', r like 'ERR:P0002%' and not exists (select 1 from public.photos where id = id1), r);

  perform t.put_objects('public', id2, 9000000);   -- fichier trop gros
  r := t.as_role('anon', null, format($q$select public.register_photo(%L,'public',%L,'00000000-0000-0000-0000-0000000000a1','clean')->>'result'$q$, id2, t.sha('trop-gros')));
  perform t.expect('T16b', 'fichier trop lourd => refusé', r like 'ERR:22023%', r);

  r := t.as_role('anon', null, format($q$select public.register_photo(%L,'public',%L,'00000000-0000-0000-0000-0000000000a1','clean')->>'result'$q$, id3, t.sha('inexistante')));
  perform t.expect('T16c', 'aucun fichier envoyé => refusé', r like 'ERR:P0002%', r);

  r := t.as_role('anon', null, format($q$select public.register_photo(%L,'public','pas-un-sha','00000000-0000-0000-0000-0000000000a1','clean')->>'result'$q$, id3));
  perform t.expect('T26', 'empreinte invalide => refusé', r like 'ERR:22023%', r);
  r := t.as_role('anon', null, format($q$select public.register_photo(%L,'autre',%L,'00000000-0000-0000-0000-0000000000a1','clean')->>'result'$q$, id3, t.sha('x')));
  perform t.expect('T26b', 'destination invalide => refusé', r like 'ERR:22023%', r);
end $$;

-- ---------------------------------------------------------------- T24 : idempotence / T23 : suppression
do $$
declare id1 uuid := gen_random_uuid(); r1 text; r2 text; adm uuid := 'aaaaaaaa-0000-0000-0000-000000000001'; r text; id2 uuid; id3 uuid;
begin
  perform t.put_objects('public', id1);
  r1 := t.as_role('anon', null, format($q$select public.register_photo(%L,'public',%L,'00000000-0000-0000-0000-0000000000a1','clean')->>'result'$q$, id1, t.sha('idem')));
  r2 := t.as_role('anon', null, format($q$select public.register_photo(%L,'public',%L,'00000000-0000-0000-0000-0000000000a1','clean')->>'result'$q$, id1, t.sha('idem')));
  perform t.expect('T24', 'réessai avec le même id : même résultat, une seule ligne',
    r1 = r2 and (select count(*) from public.photos where id = id1) = 1, r1 || ' / ' || r2);
  r2 := t.as_role('anon', null, format($q$select public.register_photo(%L,'public',%L,'00000000-0000-0000-0000-0000000000b2','clean')->>'result'$q$, id1, t.sha('idem')));
  perform t.expect('T24b', 'autre navigateur ne peut pas "rejouer" un id existant', r2 like 'ERR:42501%', r2);

  -- suppression : libère l'empreinte, est définitive
  perform t.as_role('authenticated', adm, format($q$select public.admin_set_status(%L, 'deleted')->>'result'$q$, id1));
  perform t.expect('T23', 'suppression admin => status deleted', t.status_of(id1) = 'deleted');
  r := t.as_role('authenticated', adm, format($q$select public.admin_set_status(%L, 'published')->>'result'$q$, id1));
  perform t.expect('T23b', 'une photo supprimée ne peut plus être restaurée', r = 'OK:not_found', r);
  id2 := t.guest_register('public', 'idem', 'clean');
  perform t.expect('T23c', 'une photo supprimée libère son empreinte (renvoi possible)', t.status_of(id2) = 'published', t.status_of(id2));

  -- une photo masquée reste un doublon (pas de résurrection par renvoi)
  perform t.as_role('authenticated', adm, format($q$select public.admin_set_status(%L, 'hidden')->>'result'$q$, id2));
  id3 := gen_random_uuid();
  perform t.put_objects('public', id3);
  r := t.as_role('anon', null, format($q$select public.register_photo(%L,'public',%L,'00000000-0000-0000-0000-0000000000a1','clean')->>'result'$q$, id3, t.sha('idem')));
  perform t.expect('T23d', 'renvoyer une photo masquée => duplicate (elle ne ressuscite pas)', r = 'OK:duplicate', r);
end $$;

-- ---------------------------------------------------------------- T17 : pagination keyset (130 photos, égalités de dates, insertions pendant la lecture)
do $$
declare i int; v_id uuid;
begin
  delete from public.photos where audience = 'public';   -- 130 photos publiées : 10 par date identique (départage par id)
  for i in 1..130 loop
    v_id := gen_random_uuid();
    insert into public.photos (id, audience, status, full_path, thumb_path, original_sha256, uploader_id, published_at)
    values (v_id, 'public', 'published', 'public/full/' || v_id::text || '.jpg', 'public/thumbs/' || v_id::text || '.jpg',
            t.sha('pg-' || i), '00000000-0000-0000-0000-0000000000c3',
            date_trunc('second', now()) - make_interval(secs => (i / 10) * 60));
  end loop;
end $$;
do $$
declare seen uuid[] := '{}'; lp timestamptz; li uuid; rec record; n int; pages int := 0; dups int := 0; v_new uuid; r text;
begin
  loop
    n := 0;
    for rec in select * from public.gallery_page(48, lp, li) loop
      if rec.id = any (seen) then dups := dups + 1; end if;
      seen := seen || rec.id; lp := rec.published_at; li := rec.id; n := n + 1;
    end loop;
    pages := pages + 1;
    -- pendant la lecture, une nouvelle photo arrive en haut de la galerie (ne doit ni dupliquer ni faire perdre d'éléments)
    if pages = 1 then
      v_new := gen_random_uuid();
      insert into public.photos (id, audience, status, full_path, thumb_path, original_sha256, uploader_id, published_at)
      values (v_new, 'public', 'published', 'public/full/' || v_new::text || '.jpg', 'public/thumbs/' || v_new::text || '.jpg',
              t.sha('arrivee-tardive'), '00000000-0000-0000-0000-0000000000c3', now());
    end if;
    exit when n < 48 or pages > 10;
  end loop;
  perform t.expect('T17', 'pagination keyset 48 : 130 photos, aucun doublon malgré les dates identiques et une arrivée en cours de lecture',
    dups = 0 and cardinality(seen) = 130 and pages = 3, format('lues=%s doublons=%s pages=%s', cardinality(seen), dups, pages));
  r := t.as_role('anon', null, $q$select count(*) from public.gallery_page(1000)$q$);
  perform t.expect('T17b', 'gallery_page plafonne la taille de page à 100', r = 'OK:100', r);
end $$;

-- ---------------------------------------------------------------- T19 : attaques directes depuis un client invité
do $$
declare r text; usr uuid := 'bbbbbbbb-0000-0000-0000-000000000002'; pid uuid := (select id from public.photos where audience = 'public' limit 1); role_ text;
begin
  foreach role_ in array array['anon', 'authenticated'] loop
    r := t.as_role(role_, usr, $q$with i as (insert into public.photos (id,audience,status,full_path,thumb_path,original_sha256,uploader_id) values (gen_random_uuid(),'public','published','x','y',repeat('a',64),gen_random_uuid()) returning 1) select count(*) from i$q$);
    perform t.expect('T19-' || role_ || '-a', role_ || ' : INSERT direct dans photos refusé', r like 'ERR:42501%', r);
    r := t.as_role(role_, usr, format($q$with u as (update public.photos set status = 'published' where id = %L returning 1) select count(*) from u$q$, pid));
    perform t.expect('T19-' || role_ || '-b', role_ || ' : UPDATE direct de photos refusé', r like 'ERR:42501%', r);
    r := t.as_role(role_, usr, $q$with d as (delete from public.photos returning 1) select count(*) from d$q$);
    perform t.expect('T19-' || role_ || '-c', role_ || ' : DELETE direct sur photos refusé', r like 'ERR:42501%', r);
    r := t.as_role(role_, usr, $q$select count(original_sha256) from public.photos$q$);
    perform t.expect('T19-' || role_ || '-d', role_ || ' : colonne original_sha256 illisible', r like 'ERR:42501%', r);
    r := t.as_role(role_, usr, $q$select count(uploader_id) from public.photos$q$);
    perform t.expect('T19-' || role_ || '-e', role_ || ' : colonne uploader_id illisible', r like 'ERR:42501%', r);
    r := t.as_role(role_, usr, $q$select count(review_reason) from public.photos$q$);
    perform t.expect('T19-' || role_ || '-f', role_ || ' : colonne review_reason illisible', r like 'ERR:42501%', r);
    r := t.as_role(role_, usr, $q$select count(*) from public.photo_reports$q$);
    perform t.expect('T19-' || role_ || '-g', role_ || ' : photo_reports illisible', r like 'ERR:42501%', r);
    r := t.as_role(role_, usr, $q$with i as (insert into public.photo_reports (photo_id, reporter_id) select id, gen_random_uuid() from public.photos limit 1 returning 1) select count(*) from i$q$);
    perform t.expect('T19-' || role_ || '-h', role_ || ' : INSERT direct de signalements refusé (pas de faux votes)', r like 'ERR:42501%', r);
    r := t.as_role(role_, usr, $q$select count(*) from public.app_settings$q$);
    perform t.expect('T19-' || role_ || '-i', role_ || ' : app_settings illisible', r like 'ERR:42501%', r);
    r := t.as_role(role_, usr, $q$with u as (update public.app_settings set value = 'true'::jsonb returning 1) select count(*) from u$q$);
    perform t.expect('T19-' || role_ || '-j', role_ || ' : app_settings non modifiable', r like 'ERR:42501%', r);
    r := t.as_role(role_, usr, format($q$with i as (insert into public.admin_users (user_id) values (%L) returning 1) select count(*) from i$q$, usr));
    perform t.expect('T19-' || role_ || '-k', role_ || ' : impossible de s''ajouter dans admin_users', r like 'ERR:42501%', r);
    r := t.as_role(role_, usr, $q$select count(*) from public.admin_users$q$);
    perform t.expect('T19-' || role_ || '-l', role_ || ' : admin_users illisible', r like 'ERR:42501%', r);
    r := t.as_role(role_, usr, format($q$select public.admin_set_status(%L, 'hidden')->>'result'$q$, pid));
    perform t.expect('T19-' || role_ || '-m', role_ || ' : admin_set_status refusé', r like 'ERR:42501%', r);
    r := t.as_role(role_, usr, $q$select public.admin_set_paused(true)->>'paused'$q$);
    perform t.expect('T19-' || role_ || '-n', role_ || ' : admin_set_paused refusé', r like 'ERR:42501%', r);
    r := t.as_role(role_, usr, $q$select public.admin_release_pending('paused')->>'released'$q$);
    perform t.expect('T19-' || role_ || '-o', role_ || ' : admin_release_pending refusé', r like 'ERR:42501%', r);
    r := t.as_role(role_, usr, $q$select count(*) from public.admin_orphans()$q$);
    perform t.expect('T19-' || role_ || '-p', role_ || ' : admin_orphans refusé', r like 'ERR:42501%', r);
  end loop;

  -- Storage : dépôt avec bon chemin autorisé ; mauvais chemin / suppression / écrasement refusés
  foreach role_ in array array['anon', 'authenticated'] loop
    r := t.as_role(role_, usr, format($q$with i as (insert into storage.objects (bucket_id, name, metadata) values ('photos', 'public/full/%s.jpg', '{"size":1,"mimetype":"image/jpeg"}') returning 1) select count(*) from i$q$, gen_random_uuid()));
    perform t.expect('T19-' || role_ || '-s1', role_ || ' : dépôt Storage au bon chemin autorisé', r = 'OK:1', r);
    -- Variante pessimiste : si l'API Storage utilise INSERT ... RETURNING *, PostgreSQL applique aussi les policies SELECT.
    -- Ce test documente le comportement ; voir supabase/README.md ("Vérification n°1 sur le vrai Supabase").
    r := t.as_role(role_, usr, format($q$with i as (insert into storage.objects (bucket_id, name, metadata) values ('photos', 'public/full/%s.jpg', '{"size":1,"mimetype":"image/jpeg"}') returning *) select count(*) from i$q$, gen_random_uuid()));
    perform t.expect('T19-' || role_ || '-s1b', 'INFO ' || role_ || ' : dépôt Storage avec RETURNING * (voir README, vérification n°1)', true, r);
    r := t.as_role(role_, usr, $q$with i as (insert into storage.objects (bucket_id, name, metadata) values ('photos', 'public/full/../../secret.jpg', '{}') returning 1) select count(*) from i$q$);
    perform t.expect('T19-' || role_ || '-s2', role_ || ' : dépôt Storage hors format de chemin refusé', r like 'ERR:42501%', r);
    r := t.as_role(role_, usr, $q$with i as (insert into storage.objects (bucket_id, name, metadata) values ('photos', 'public/autre/' || gen_random_uuid()::text || '.jpg', '{}') returning 1) select count(*) from i$q$);
    perform t.expect('T19-' || role_ || '-s3', role_ || ' : dépôt Storage dans un dossier inconnu refusé', r like 'ERR:42501%', r);
    r := t.as_role(role_, usr, $q$with i as (insert into storage.objects (bucket_id, name, metadata) values ('autre-bucket', 'public/full/' || gen_random_uuid()::text || '.jpg', '{}') returning 1) select count(*) from i$q$);
    perform t.expect('T19-' || role_ || '-s4', role_ || ' : dépôt dans un autre bucket refusé', r like 'ERR:%', r);
    r := t.as_role(role_, usr, $q$with d as (delete from storage.objects returning 1) select count(*) from d$q$);
    perform t.expect('T19-' || role_ || '-s5', role_ || ' : suppression Storage : 0 ligne supprimable', r = 'OK:0', r);
    r := t.as_role(role_, usr, $q$with u as (update storage.objects set name = name returning 1) select count(*) from u$q$);
    perform t.expect('T19-' || role_ || '-s6', role_ || ' : écrasement Storage : 0 ligne modifiable', r = 'OK:0', r);
  end loop;

  -- Un admin lit les objets privés ; un invité jamais
  r := t.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001', $q$select count(*) from storage.objects where name like 'maries/%'$q$);
  perform t.expect('T13e', 'admin : lecture des objets privés possible', r like 'OK:%' and r <> 'OK:0', r);
  r := t.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001', $q$with d as (delete from storage.objects where name like 'maries/%' returning 1) select count(*) from d$q$);
  perform t.expect('T13f', 'admin : suppression Storage possible', r like 'OK:%' and r <> 'OK:0', r);
end $$;

-- ---------------------------------------------------------------- T22 : limite de fréquence des signalements / T28 : plafond d'envois
do $$
declare i int; v_id uuid; r text; rr uuid := '99999999-9999-9999-9999-999999999999'; last_res text; up uuid := '00000000-0000-0000-0000-0000000000d4';
begin
  delete from public.photos;
  for i in 1..16 loop
    v_id := t.guest_register('public', 'rl-' || i, 'clean');
  end loop;
  -- 5 signalements / 10 min / navigateur : le 6e est refusé
  for v_id in select id from public.photos order by id limit 6 loop
    last_res := t.as_role('anon', null, format($q$select public.report_photo(%L, %L, 'sexual')->>'result'$q$, v_id, rr));
  end loop;
  perform t.expect('T22', 'plus de 5 signalements en 10 min par le même navigateur => rate_limited', last_res = 'OK:rate_limited', last_res);
  -- frein global : 12 photos différentes signalées en 10 min au plus, quel que soit le navigateur
  for v_id in select id from public.photos where status = 'published' order by id limit 7 loop
    last_res := t.as_role('anon', null, format($q$select public.report_photo(%L, gen_random_uuid(), 'violence')->>'result'$q$, v_id));
  end loop;
  last_res := t.as_role('anon', null, format($q$select public.report_photo(%L, gen_random_uuid(), 'violence')->>'result'$q$, (select id from public.photos where status = 'published' limit 1)));
  perform t.expect('T22b', 'plus de 12 photos signalées en 10 min au total => rate_limited (frein aux scripts)',
    last_res = 'OK:rate_limited' or last_res = 'OK:not_found', last_res);
  perform t.expect('T22c', 'le frein global limite le nombre de masquages (<= 12)', (select count(*) from public.photos where status = 'hidden' and review_reason = 'reports') <= 12);

  for i in 1..500 loop
    v_id := gen_random_uuid();
    insert into public.photos (id, audience, status, full_path, thumb_path, original_sha256, uploader_id, published_at)
    values (v_id, 'maries', 'published', 'maries/full/' || v_id::text || '.jpg', 'maries/thumbs/' || v_id::text || '.jpg',
            t.sha('plafond-' || i), up, now());
  end loop;
  v_id := gen_random_uuid(); perform t.put_objects('public', v_id);
  r := t.as_role('anon', null, format($q$select public.register_photo(%L,'public',%L,%L,'clean')->>'result'$q$, v_id, t.sha('apres-plafond'), up));
  perform t.expect('T28', 'plafond de 500 envois / 24 h par navigateur => rate_limited', r = 'OK:rate_limited', r);
end $$;

-- ---------------------------------------------------------------- T27 : fichiers orphelins
do $$
declare v_orphan uuid := gen_random_uuid(); v_kept uuid; r text; adm uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
begin
  perform t.put_objects('public', v_orphan, 300000, interval '2 hours');
  r := t.as_role('authenticated', adm, $q$select count(*) from public.admin_orphans()$q$);
  perform t.expect('T27', 'admin_orphans liste les fichiers sans ligne photos (> 30 min)', r like 'OK:%' and r <> 'OK:0', r);
  v_kept := t.guest_register('public', 'orpheline-non', 'clean');
  update storage.objects set created_at = now() - interval '2 hours' where name like '%/' || v_kept::text || '.jpg';
  r := t.as_role('authenticated', adm, format($q$select count(*) from public.admin_orphans() where name like %L$q$, '%/' || v_kept::text || '.jpg'));
  perform t.expect('T27b', 'admin_orphans ne liste pas les fichiers rattachés à une photo', r = 'OK:0', r);
end $$;

-- ---------------------------------------------------------------- T29 : politiques en place
do $$
begin
  perform t.expect('T29', 'bucket "photos" privé, JPEG, 3 Mo',
    exists (select 1 from storage.buckets where id = 'photos' and public = false and file_size_limit = 3145728 and allowed_mime_types = array['image/jpeg']));
  perform t.expect('T29b', 'RLS active sur photos, photo_reports, app_settings, admin_users',
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('photos','photo_reports','app_settings','admin_users') and c.relrowsecurity) = 4);
  perform t.expect('T29c', 'aucune policy INSERT/UPDATE/DELETE sur les tables publiques',
    not exists (select 1 from pg_policies where schemaname = 'public' and cmd in ('INSERT','UPDATE','DELETE','ALL')));
  perform t.expect('T29d', 'aucune policy UPDATE sur storage.objects',
    not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd in ('UPDATE','ALL')));
end $$;

select id, case when ok then 'PASS' else 'FAIL' end as result, name, case when ok then '' else coalesce(detail, '') end as detail
  from t.results order by seq;
