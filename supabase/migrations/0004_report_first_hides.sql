-- =====================================================================
-- 0004_report_first_hides.sql : UN SEUL signalement motivé masque la photo (en attendant l'administrateur)
-- Incrémentale et rejouable. Aucune donnée n'est supprimée ni réinitialisée : les signalements existants sont conservés
-- (motifs anciens 'embarrassing' / 'child' / 'other' toujours valides en lecture).
-- À exécuter dans Supabase > SQL Editor APRÈS 0001, 0002 et 0003, puis publier le site (le nouveau formulaire envoie un motif
-- parmi sexual | violence | privacy | inappropriate | other et un commentaire facultatif).
--
-- Règles côté serveur, dans UNE transaction avec verrou de la ligne de la photo :
--   - 1er signalement valide d'une photo publique publiée => photo 'hidden' / raison 'reports' (fichiers conservés, jamais supprimée seule) ;
--   - motif obligatoire parmi 5 valeurs ; « other » exige une description (3 à 500 caractères) ; commentaire ≤ 500 caractères ;
--   - un même navigateur ne peut pas re-signaler une photo tant que son signalement est ouvert ; au plus 3 signalements par photo et par navigateur ;
--   - 5 signalements / 10 min / navigateur ; au plus 12 photos différentes signalées / 10 min au total (frein aux envois automatisés) ;
--   - restauration par l'admin : les signalements sont CONSERVÉS mais marqués résolus ; ils ne remasquent jamais la photo ;
--     seul un NOUVEAU signalement valide la remasque.
-- Les décisions de l'administrateur sont tracées dans public.photo_moderation.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Signalements : commentaire, résolution, motifs, plus d'unicité (photo, navigateur) mais contrôles dans la fonction
-- ---------------------------------------------------------------------
alter table public.photo_reports add column if not exists comment text;
alter table public.photo_reports add column if not exists resolved_at timestamptz;
alter table public.photo_reports add column if not exists resolution text;

alter table public.photo_reports drop constraint if exists photo_reports_reason_check;
alter table public.photo_reports add constraint photo_reports_reason_check
  check (reason is null or reason in ('sexual', 'violence', 'privacy', 'inappropriate', 'other', 'embarrassing', 'child'));
alter table public.photo_reports drop constraint if exists photo_reports_comment_len;
alter table public.photo_reports add constraint photo_reports_comment_len
  check (comment is null or char_length(comment) <= 500);
alter table public.photo_reports drop constraint if exists photo_reports_resolution_check;
alter table public.photo_reports add constraint photo_reports_resolution_check
  check (resolution is null or resolution in ('restored', 'kept_hidden', 'deleted'));
-- L'ancienne contrainte unique (photo_id, reporter_id) empêchait tout nouveau signalement après restauration.
alter table public.photo_reports drop constraint if exists photo_reports_photo_id_reporter_id_key;
create index if not exists photo_reports_open_idx on public.photo_reports (photo_id) where resolved_at is null;
create index if not exists photo_reports_photo_reporter_idx on public.photo_reports (photo_id, reporter_id);
create index if not exists photo_reports_recent_idx on public.photo_reports (created_at);

-- ---------------------------------------------------------------------
-- Trace des décisions de modération (jamais lisible par les invités)
-- ---------------------------------------------------------------------
create table if not exists public.photo_moderation (
  id              uuid primary key default gen_random_uuid(),
  photo_id        uuid not null references public.photos (id) on delete cascade,
  admin_id        uuid,
  action          text not null check (action in ('restored', 'kept_hidden', 'deleted', 'published', 'hidden')),
  previous_status text,
  new_status      text,
  open_reports    int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists photo_moderation_photo_idx on public.photo_moderation (photo_id, created_at desc);
alter table public.photo_moderation enable row level security;
revoke all on public.photo_moderation from anon, authenticated;

-- ---------------------------------------------------------------------
-- Signalement : 1er signalement valide => photo masquée, atomiquement.
-- Résultats : reported | already_reported | not_found | rate_limited ; erreurs 22023 : invalid_input, invalid_reason,
--   comment_required, comment_too_long. 'not_found' = photo inexistante, privée, en attente, supprimée ou masquée par un admin.
-- Une photo déjà masquée par un signalement accepte les signalements suivants (compte et motifs conservés pour l'admin).
-- ---------------------------------------------------------------------
drop function if exists public.report_photo(uuid, uuid, text);
create or replace function public.report_photo(
  p_photo_id uuid, p_reporter uuid, p_reason text, p_comment text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_photo   public.photos%rowtype;
  v_comment text;
  v_recent  int;
  v_same    int;
  v_open    int;
  v_flood   int;
  v_hid     boolean := false;
begin
  if p_photo_id is null or p_reporter is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_reason is null or p_reason not in ('sexual', 'violence', 'privacy', 'inappropriate', 'other') then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  v_comment := nullif(btrim(regexp_replace(coalesce(p_comment, ''), '[[:cntrl:]]', ' ', 'g')), '');
  if v_comment is not null and char_length(v_comment) > 500 then
    raise exception 'comment_too_long' using errcode = '22023';
  end if;
  if p_reason = 'other' and (v_comment is null or char_length(v_comment) < 3) then
    raise exception 'comment_required' using errcode = '22023';
  end if;

  -- Verrou de la ligne : deux signalements simultanés sont sérialisés (un seul masquage, deux signalements enregistrés).
  select * into v_photo from public.photos
   where id = p_photo_id and audience = 'public'
     and (status = 'published' or (status = 'hidden' and review_reason = 'reports'))
   for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  select count(*) filter (where resolved_at is null), count(*) into v_open, v_same
    from public.photo_reports where photo_id = p_photo_id and reporter_id = p_reporter;
  if v_open > 0 or v_same >= 3 then
    return jsonb_build_object('result', 'already_reported');
  end if;

  select count(*) into v_recent from public.photo_reports
   where reporter_id = p_reporter and created_at > now() - interval '10 minutes';
  if v_recent >= 5 then
    return jsonb_build_object('result', 'rate_limited');
  end if;
  -- Frein global : avec un seul signalement suffisant, un script ne doit pas pouvoir vider la galerie d'un coup.
  select count(distinct photo_id) into v_flood from public.photo_reports
   where created_at > now() - interval '10 minutes';
  if v_flood >= 12 then
    return jsonb_build_object('result', 'rate_limited');
  end if;

  insert into public.photo_reports (photo_id, reporter_id, reason, comment)
  values (p_photo_id, p_reporter, p_reason, v_comment);

  if v_photo.status = 'published' then
    update public.photos set status = 'hidden', review_reason = 'reports' where id = p_photo_id;
    v_hid := true;
  end if;
  return jsonb_build_object('result', 'reported', 'hidden', v_hid);
end $$;

-- ---------------------------------------------------------------------
-- Admin : décisions (restaurer / maintenir masquée / supprimer) — les signalements ouverts sont résolus, pas effacés
-- ---------------------------------------------------------------------
create or replace function public.admin_set_status(p_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prev public.photos%rowtype;
  v_open int;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status not in ('published', 'hidden', 'deleted') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  select * into v_prev from public.photos where id = p_id and status <> 'deleted' for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  select count(*) into v_open from public.photo_reports where photo_id = p_id and resolved_at is null;
  update public.photos set
         status = p_status,
         review_reason = case p_status when 'published' then null when 'hidden' then 'admin' else review_reason end,
         published_at = case when p_status = 'published' then coalesce(published_at, now()) else published_at end
   where id = p_id;
  update public.photo_reports
     set resolved_at = now(),
         resolution = case p_status when 'published' then 'restored' when 'hidden' then 'kept_hidden' else 'deleted' end
   where photo_id = p_id and resolved_at is null;
  insert into public.photo_moderation (photo_id, admin_id, action, previous_status, new_status, open_reports)
  values (p_id, auth.uid(),
          case p_status
            when 'published' then case when v_open > 0 then 'restored' else 'published' end
            when 'hidden'    then case when v_open > 0 then 'kept_hidden' else 'hidden' end
            else 'deleted' end,
          v_prev.status, p_status, v_open);
  return jsonb_build_object('result', p_status);
end $$;

-- ---------------------------------------------------------------------
-- Admin : liste enrichie (miniature via chemins, signalements détaillés, dernière décision). Le type de retour change :
-- l'ancienne fonction est remplacée (aucune donnée concernée).
-- ---------------------------------------------------------------------
drop function if exists public.admin_list_photos(text, int, int);
create or replace function public.admin_list_photos(
  p_filter text default 'recent', p_limit int default 50, p_offset int default 0
) returns table (
  id uuid, audience text, status text, review_reason text, full_path text, thumb_path text,
  created_at timestamptz, published_at timestamptz,
  report_count int, open_reports int, report_reasons text[], last_report_at timestamptz,
  reports jsonb, last_decision jsonb
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_filter not in ('recent', 'reported', 'pending', 'hidden', 'maries') then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;
  return query
  select p.id, p.audience, p.status, p.review_reason, p.full_path, p.thumb_path, p.created_at, p.published_at,
         coalesce(r.total, 0)::int, coalesce(r.open_n, 0)::int, coalesce(r.open_reasons, '{}'), r.last_at,
         coalesce(r.details, '[]'::jsonb), m.decision
    from public.photos p
    left join lateral (
      select count(*) as total,
             count(*) filter (where x.resolved_at is null) as open_n,
             array_agg(distinct x.reason) filter (where x.reason is not null and x.resolved_at is null) as open_reasons,
             max(x.created_at) as last_at,
             (select jsonb_agg(jsonb_build_object('at', d.created_at, 'reason', d.reason, 'comment', d.comment,
                                                  'resolved', d.resolved_at is not null, 'resolution', d.resolution)
                               order by d.created_at desc)
                from (select * from public.photo_reports y where y.photo_id = p.id order by y.created_at desc limit 20) d) as details
        from public.photo_reports x where x.photo_id = p.id
    ) r on true
    left join lateral (
      select jsonb_build_object('action', z.action, 'at', z.created_at) as decision
        from public.photo_moderation z where z.photo_id = p.id order by z.created_at desc limit 1
    ) m on true
   where p.status <> 'deleted'
     and case p_filter
           when 'recent'   then p.audience = 'public'
           when 'reported' then coalesce(r.open_n, 0) > 0
           when 'pending'  then p.status = 'pending_review'
           when 'hidden'   then p.status = 'hidden'
           when 'maries'   then p.audience = 'maries'
         end
   order by case when p_filter = 'reported' then r.last_at end desc nulls last, p.created_at desc, p.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end $$;

create or replace function public.admin_status() returns jsonb
language plpgsql stable security definer set search_path = public, storage, pg_temp as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select jsonb_build_object(
    'paused',   coalesce((select (value)::boolean from public.app_settings where key = 'publications_paused'), false),
    'published', (select count(*) from public.photos where audience = 'public' and status = 'published'),
    'reported',  (select count(distinct r.photo_id) from public.photo_reports r join public.photos p on p.id = r.photo_id
                   where r.resolved_at is null and p.status <> 'deleted'),
    'pending',   (select count(*) from public.photos where status = 'pending_review'),
    'hidden',    (select count(*) from public.photos where status = 'hidden'),
    'maries',    (select count(*) from public.photos where audience = 'maries' and status <> 'deleted'),
    'storage_bytes',   (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects where bucket_id = 'photos'),
    'storage_objects', (select count(*) from storage.objects where bucket_id = 'photos')
  ) into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Droits d'exécution (comme 0002 : tout retirer, puis accorder au strict nécessaire)
-- ---------------------------------------------------------------------
revoke all on function
  public.report_photo(uuid, uuid, text, text), public.admin_set_status(uuid, text),
  public.admin_list_photos(text, int, int), public.admin_status()
  from public, anon, authenticated;
grant execute on function public.report_photo(uuid, uuid, text, text) to anon, authenticated;
grant execute on function
  public.admin_set_status(uuid, text), public.admin_list_photos(text, int, int), public.admin_status()
  to authenticated;
