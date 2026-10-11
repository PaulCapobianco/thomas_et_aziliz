-- =====================================================================
-- 0002_functions.sql : toutes les écritures sensibles passent par ces fonctions
-- (SECURITY DEFINER, search_path figé, droits d'exécution explicites).
-- Idempotent. À exécuter après 0001.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Aides
-- ---------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

-- Vrai si l'objet Storage appartient à une photo publique publiée (utilisé par la policy de lecture Storage).
create or replace function public.object_is_public(p_name text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.photos p
    where p.audience = 'public' and p.status = 'published'
      and (p.full_path = p_name or p.thumb_path = p_name)
  );
$$;

-- ---------------------------------------------------------------------
-- Doublons : renvoie les empreintes déjà présentes dans CETTE destination (hors photos supprimées)
-- ---------------------------------------------------------------------
create or replace function public.check_duplicates(p_audience text, p_hashes text[]) returns text[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_audience not in ('public', 'maries') then
    raise exception 'invalid_audience' using errcode = '22023';
  end if;
  if p_hashes is null or cardinality(p_hashes) > 200 then
    raise exception 'invalid_hashes' using errcode = '22023';
  end if;
  return coalesce((
    select array_agg(p.original_sha256)
    from public.photos p
    where p.audience = p_audience and p.status <> 'deleted' and p.original_sha256 = any (p_hashes)
  ), '{}');
end $$;

-- ---------------------------------------------------------------------
-- Finalisation d'un envoi : à appeler APRÈS l'upload réussi des DEUX fichiers (full + thumb).
--   p_nsfw : 'clean' | 'suspect' | 'unavailable' | 'skipped'   ('skipped' = envoi privé aux mariés)
-- Le serveur décide du statut ; le client ne peut pas choisir 'published' pour une photo publique
-- suspecte ou non vérifiée. (Un client malveillant peut mentir en envoyant 'clean' :
-- NSFWJS est une aide préventive, pas un contrôle de sécurité. Les signalements et l'admin restent le filet.)
-- Résultats : published | pending_review | duplicate | rate_limited | registered
-- ---------------------------------------------------------------------
create or replace function public.register_photo(
  p_id uuid, p_audience text, p_sha256 text, p_uploader uuid, p_nsfw text
) returns jsonb
language plpgsql security definer set search_path = public, storage, pg_temp as $$
declare
  v_full    text;
  v_thumb   text;
  v_status  text;
  v_reason  text;
  v_paused  boolean;
  v_exist   public.photos%rowtype;
  v_count   int;
  v_size    bigint;
  v_mime    text;
  v_max_object_bytes constant bigint := 3145728;   -- 3 Mo par fichier (le bucket impose aussi cette limite)
  v_max_per_day      constant int    := 500;       -- garde-fou contre une boucle de renvois, pas une sécurité anti-abus
begin
  if p_id is null or p_uploader is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_audience not in ('public', 'maries') then
    raise exception 'invalid_audience' using errcode = '22023';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_sha256' using errcode = '22023';
  end if;
  if p_nsfw is null or p_nsfw not in ('clean', 'suspect', 'unavailable', 'skipped') then
    raise exception 'invalid_nsfw_verdict' using errcode = '22023';
  end if;

  v_full  := p_audience || '/full/'   || p_id::text || '.jpg';
  v_thumb := p_audience || '/thumbs/' || p_id::text || '.jpg';

  -- Idempotence : un réessai avec le même id ne crée rien de plus.
  select * into v_exist from public.photos where id = p_id;
  if found then
    if v_exist.uploader_id <> p_uploader then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    return jsonb_build_object('result', case v_exist.status
      when 'published' then 'published' when 'pending_review' then 'pending_review' else 'registered' end);
  end if;

  select count(*) into v_count from public.photos
   where uploader_id = p_uploader and created_at > now() - interval '1 day';
  if v_count >= v_max_per_day then
    return jsonb_build_object('result', 'rate_limited');
  end if;

  -- Les DEUX fichiers doivent exister, être des JPEG et respecter la taille maximale.
  for v_size, v_mime in
    select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype'
      from storage.objects o
     where o.bucket_id = 'photos' and o.name in (v_full, v_thumb)
  loop
    if v_size is null or v_size < 1 or v_size > v_max_object_bytes or v_mime is distinct from 'image/jpeg' then
      raise exception 'invalid_object' using errcode = '22023';
    end if;
  end loop;
  select count(*) into v_count from storage.objects o
   where o.bucket_id = 'photos' and o.name in (v_full, v_thumb);
  if v_count <> 2 then
    raise exception 'missing_object' using errcode = 'P0002';
  end if;

  select coalesce((value)::boolean, false) into v_paused from public.app_settings where key = 'publications_paused';

  -- Décision de statut (la suspicion NSFW prime sur la pause, pour qu'une "reprise" ne publie jamais une photo suspecte)
  if p_audience = 'maries' then
    v_status := 'published'; v_reason := null;       -- "published" = acceptée ; la visibilité dépend UNIQUEMENT de audience
  elsif p_nsfw = 'suspect' then
    v_status := 'pending_review'; v_reason := 'nsfw';
  elsif p_nsfw in ('unavailable', 'skipped') then
    v_status := 'pending_review'; v_reason := 'model_unavailable';
  elsif coalesce(v_paused, false) then
    v_status := 'pending_review'; v_reason := 'paused';
  else
    v_status := 'published'; v_reason := null;
  end if;

  insert into public.photos (id, audience, status, review_reason, full_path, thumb_path,
                             original_sha256, uploader_id, published_at)
  values (p_id, p_audience, v_status, v_reason, v_full, v_thumb,
          p_sha256, p_uploader, case when v_status = 'published' then now() end)
  on conflict (audience, original_sha256) where status <> 'deleted' do nothing;
  get diagnostics v_count = row_count;

  if v_count = 0 then
    -- Doublon exact : les 2 fichiers déjà envoyés restent orphelins (visibles via admin_orphans()).
    return jsonb_build_object('result', 'duplicate');
  end if;
  return jsonb_build_object('result', v_status);
end $$;

-- ---------------------------------------------------------------------
-- Signalement : ATOMIQUE. Verrou sur la ligne de la photo => deux votes simultanés sont sérialisés.
-- Résultats : reported | already_reported | not_found | rate_limited
--   not_found = photo inexistante, non publique, déjà masquée ou en attente (le client dit simplement "merci").
-- ---------------------------------------------------------------------
create or replace function public.report_photo(p_photo_id uuid, p_reporter uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_photo    public.photos%rowtype;
  v_inserted int;
  v_votes    int;
  v_recent   int;
begin
  if p_photo_id is null or p_reporter is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_reason is not null and p_reason not in ('embarrassing', 'child', 'other') then
    p_reason := 'other';
  end if;

  select * into v_photo from public.photos
   where id = p_photo_id and audience = 'public' and status = 'published'
   for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  select count(*) into v_recent from public.photo_reports
   where reporter_id = p_reporter and created_at > now() - interval '10 minutes';
  if v_recent >= 20 then
    return jsonb_build_object('result', 'rate_limited');
  end if;

  insert into public.photo_reports (photo_id, reporter_id, reason)
  values (p_photo_id, p_reporter, p_reason)
  on conflict (photo_id, reporter_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('result', 'already_reported');
  end if;

  select count(distinct reporter_id) into v_votes from public.photo_reports where photo_id = p_photo_id;
  if v_votes >= 2 then
    update public.photos set status = 'hidden', review_reason = 'reports' where id = p_photo_id;
  end if;
  return jsonb_build_object('result', 'reported');
end $$;

-- ---------------------------------------------------------------------
-- Galerie publique : pagination KEYSET (stable même quand de nouvelles photos arrivent en haut).
-- Appel suivant : p_before_published / p_before_id = dernière ligne reçue.
-- SECURITY INVOKER : la RLS de la table s'applique (seulement public + published).
-- ---------------------------------------------------------------------
create or replace function public.gallery_page(
  p_limit int default 48, p_before_published timestamptz default null, p_before_id uuid default null
) returns table (id uuid, full_path text, thumb_path text, published_at timestamptz)
language sql stable security invoker set search_path = public, pg_temp as $$
  select p.id, p.full_path, p.thumb_path, p.published_at
    from public.photos p
   where p.audience = 'public' and p.status = 'published'
     and (p_before_published is null or (p.published_at, p.id) < (p_before_published, p_before_id))
   order by p.published_at desc, p.id desc
   limit least(greatest(coalesce(p_limit, 48), 1), 100);
$$;

-- ---------------------------------------------------------------------
-- ADMIN (toutes vérifient is_admin() côté base : cacher un bouton ne suffit pas)
-- ---------------------------------------------------------------------
create or replace function public.admin_list_photos(
  p_filter text default 'recent', p_limit int default 50, p_offset int default 0
) returns table (
  id uuid, audience text, status text, review_reason text, full_path text, thumb_path text,
  created_at timestamptz, published_at timestamptz, report_count int, report_reasons text[]
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_filter not in ('recent', 'reported', 'pending', 'hidden', 'maries') then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;
  return query
  select p.id, p.audience, p.status, p.review_reason, p.full_path, p.thumb_path, p.created_at, p.published_at,
         coalesce(r.n, 0)::int, coalesce(r.reasons, '{}')
    from public.photos p
    left join lateral (
      select count(*) as n, array_agg(distinct x.reason) filter (where x.reason is not null) as reasons
        from public.photo_reports x where x.photo_id = p.id
    ) r on true
   where p.status <> 'deleted'
     and case p_filter
           when 'recent'   then p.audience = 'public'
           when 'reported' then coalesce(r.n, 0) > 0
           when 'pending'  then p.status = 'pending_review'
           when 'hidden'   then p.status = 'hidden'
           when 'maries'   then p.audience = 'maries'
         end
   order by p.created_at desc, p.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- Masquer / restaurer / supprimer (suppression = soft delete ; 'deleted' est définitif).
-- Restaurer ('published') efface les anciens signalements pour que la photo ne soit pas remasquée aussitôt.
-- Après 'deleted', l'interface admin supprime les 2 fichiers via storage.remove() (best effort).
create or replace function public.admin_set_status(p_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_found boolean;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status not in ('published', 'hidden', 'deleted') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  update public.photos set
         status = p_status,
         review_reason = case p_status when 'published' then null when 'hidden' then 'admin' else review_reason end,
         published_at = case when p_status = 'published' then coalesce(published_at, now()) else published_at end
   where id = p_id and status <> 'deleted';
  v_found := found;
  if not v_found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if p_status = 'published' then
    delete from public.photo_reports where photo_id = p_id;
  end if;
  return jsonb_build_object('result', p_status);
end $$;

create or replace function public.admin_set_paused(p_paused boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.app_settings (key, value, updated_at)
  values ('publications_paused', to_jsonb(coalesce(p_paused, false)), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('paused', coalesce(p_paused, false));
end $$;

-- Libère en bloc les photos publiques en attente pour une raison NON liée au contenu.
-- 'nsfw' est volontairement refusé : une photo suspecte se libère uniquement une par une (admin_set_status).
create or replace function public.admin_release_pending(p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count int;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_reason not in ('paused', 'model_unavailable') then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  update public.photos set status = 'published', review_reason = null, published_at = now()
   where audience = 'public' and status = 'pending_review' and review_reason = p_reason;
  get diagnostics v_count = row_count;
  return jsonb_build_object('released', v_count);
end $$;

-- Tableau de bord minimal (état de la pause, compteurs, poids total pour surveiller le quota).
create or replace function public.admin_status() returns jsonb
language plpgsql stable security definer set search_path = public, storage, pg_temp as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select jsonb_build_object(
    'paused',   coalesce((select (value)::boolean from public.app_settings where key = 'publications_paused'), false),
    'published', (select count(*) from public.photos where audience = 'public' and status = 'published'),
    'reported',  (select count(distinct r.photo_id) from public.photo_reports r join public.photos p on p.id = r.photo_id
                   where p.status = 'published'),
    'pending',   (select count(*) from public.photos where status = 'pending_review'),
    'hidden',    (select count(*) from public.photos where status = 'hidden'),
    'maries',    (select count(*) from public.photos where audience = 'maries' and status <> 'deleted'),
    'storage_bytes',   (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects where bucket_id = 'photos'),
    'storage_objects', (select count(*) from storage.objects where bucket_id = 'photos')
  ) into v;
  return v;
end $$;

-- Fichiers sans ligne photos depuis plus de 30 min (envoi interrompu, doublon détecté après upload).
-- La suppression se fait par l'API Storage (storage.remove), PAS par DELETE SQL (qui laisserait les fichiers).
create or replace function public.admin_orphans() returns table (name text, size bigint, created_at timestamptz)
language plpgsql stable security definer set search_path = public, storage, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select o.name, (o.metadata ->> 'size')::bigint, o.created_at
    from storage.objects o
   where o.bucket_id = 'photos' and o.created_at < now() - interval '30 minutes'
     and not exists (select 1 from public.photos p where p.full_path = o.name or p.thumb_path = o.name)
   order by o.created_at;
end $$;

-- ---------------------------------------------------------------------
-- Droits d'exécution : tout retirer, puis accorder au strict nécessaire.
-- ---------------------------------------------------------------------
revoke all on function
  public.is_admin(), public.object_is_public(text), public.check_duplicates(text, text[]),
  public.register_photo(uuid, text, text, uuid, text), public.report_photo(uuid, uuid, text),
  public.gallery_page(int, timestamptz, uuid),
  public.admin_list_photos(text, int, int), public.admin_set_status(uuid, text), public.admin_set_paused(boolean),
  public.admin_release_pending(text), public.admin_status(), public.admin_orphans()
  from public, anon, authenticated;

grant execute on function
  public.is_admin(), public.object_is_public(text), public.check_duplicates(text, text[]),
  public.register_photo(uuid, text, text, uuid, text), public.report_photo(uuid, uuid, text),
  public.gallery_page(int, timestamptz, uuid)
  to anon, authenticated;

grant execute on function
  public.admin_list_photos(text, int, int), public.admin_set_status(uuid, text), public.admin_set_paused(boolean),
  public.admin_release_pending(text), public.admin_status(), public.admin_orphans()
  to authenticated;
