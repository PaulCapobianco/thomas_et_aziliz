-- =====================================================================
-- 0005_drive_sync.sql : sauvegarde des photos vers Google Drive (état de synchronisation)
-- ADDITIVE ET IDEMPOTENTE : aucune donnée supprimée ou modifiée, aucune policy existante touchée.
-- À exécuter après 0001-0004. Ne change ni la visibilité, ni la modération, ni les chemins Storage.
--
-- Retour arrière : supabase/optional/rollback_0005_drive_sync.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- Colonnes de suivi. Les colonnes ne reçoivent AUCUN droit pour anon / authenticated :
-- 0001 n'accorde `select` qu'à une liste de colonnes explicite, donc rien de neuf n'est lisible côté client.
-- ---------------------------------------------------------------------
alter table public.photos add column if not exists drive_file_id      text;
alter table public.photos add column if not exists drive_sync_status  text not null default 'pending';
alter table public.photos add column if not exists drive_synced_at    timestamptz;
alter table public.photos add column if not exists drive_sync_error   text;
alter table public.photos add column if not exists drive_sync_attempts int  not null default 0;
alter table public.photos add column if not exists drive_locked_at    timestamptz;   -- début du traitement en cours / dernier échec
alter table public.photos add column if not exists drive_bytes        bigint;        -- taille du fichier confirmée par Drive

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'photos_drive_sync_status_check') then
    alter table public.photos add constraint photos_drive_sync_status_check
      check (drive_sync_status in ('pending', 'processing', 'transferred', 'failed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'photos_drive_transferred_has_file') then
    alter table public.photos add constraint photos_drive_transferred_has_file
      check (drive_sync_status <> 'transferred' or drive_file_id is not null);
  end if;
end $$;

create index if not exists photos_drive_queue_idx
  on public.photos (drive_sync_status, created_at) where drive_sync_status <> 'transferred';

-- ---------------------------------------------------------------------
-- File d'attente : réservée au serveur (clé service_role côté Cloudflare, jamais dans le navigateur).
-- Reprend : pending ; failed (au plus 6 essais, délai croissant) ; processing abandonné depuis plus de 10 min.
-- Les photos supprimées par l'admin ne sont jamais transférées. `for update skip locked` : deux exécutions
-- simultanées ne prennent jamais la même photo.
-- ---------------------------------------------------------------------
create or replace function public.drive_claim(p_limit int default 5, p_id uuid default null)
returns table (id uuid, audience text, full_path text, created_at timestamptz, drive_file_id text, attempts int)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  with picked as (
    select p.id as pid from public.photos p
     where p.status <> 'deleted'
       and (p_id is null or p.id = p_id)
       and (
            p.drive_sync_status = 'pending'
         or (p.drive_sync_status = 'failed' and p.drive_sync_attempts < 6
             and p.drive_locked_at < now() - make_interval(mins => 2 * greatest(p.drive_sync_attempts, 1)))
         or (p.drive_sync_status = 'processing' and p.drive_locked_at < now() - interval '10 minutes')
       )
     order by p.created_at, p.id
     limit least(greatest(coalesce(p_limit, 5), 1), 20)
     for update skip locked
  )
  update public.photos p
     set drive_sync_status = 'processing', drive_locked_at = now(), drive_sync_attempts = p.drive_sync_attempts + 1
    from picked
   where p.id = picked.pid
  returning p.id, p.audience, p.full_path, p.created_at, p.drive_file_id, p.drive_sync_attempts;
end $$;

-- Transfert vérifié par le serveur (taille + empreinte comparées à Drive AVANT cet appel).
create or replace function public.drive_mark_transferred(p_id uuid, p_file_id text, p_bytes bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_file_id is null or length(p_file_id) = 0 then raise exception 'invalid_file_id' using errcode = '22023'; end if;
  update public.photos
     set drive_sync_status = 'transferred', drive_file_id = p_file_id, drive_bytes = p_bytes,
         drive_synced_at = now(), drive_sync_error = null, drive_locked_at = null
   where id = p_id;
end $$;

create or replace function public.drive_mark_failed(p_id uuid, p_error text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.photos
     set drive_sync_status = 'failed', drive_sync_error = left(coalesce(p_error, 'unknown'), 300), drive_locked_at = now()
   where id = p_id and drive_sync_status <> 'transferred';
end $$;

-- Erreur globale (Drive inaccessible, jeton invalide) : la photo retourne en file sans consommer d'essai.
create or replace function public.drive_release(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.photos
     set drive_sync_status = 'pending', drive_sync_attempts = greatest(drive_sync_attempts - 1, 0), drive_locked_at = null
   where id = p_id and drive_sync_status = 'processing';
end $$;

-- ---------------------------------------------------------------------
-- Administration : compteurs + relance des échecs (is_admin() vérifié côté base)
-- ---------------------------------------------------------------------
create or replace function public.admin_drive_status() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return (
    select jsonb_build_object(
      'transferred', count(*) filter (where drive_sync_status = 'transferred'),
      'pending',     count(*) filter (where drive_sync_status in ('pending', 'processing')),
      'failed',      count(*) filter (where drive_sync_status = 'failed'),
      'bytes',       coalesce(sum(drive_bytes) filter (where drive_sync_status = 'transferred'), 0),
      'last_error',  (select drive_sync_error from public.photos where drive_sync_status = 'failed'
                       order by drive_locked_at desc nulls last limit 1)
    ) from public.photos where status <> 'deleted'
  );
end $$;

create or replace function public.admin_drive_retry(p_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count int;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.photos
     set drive_sync_status = 'pending', drive_sync_attempts = 0, drive_locked_at = null
   where drive_sync_status = 'failed' and (p_id is null or id = p_id);
  get diagnostics v_count = row_count;
  return jsonb_build_object('requeued', v_count);
end $$;

-- ---------------------------------------------------------------------
-- Droits : tout retirer, puis accorder au strict nécessaire
-- ---------------------------------------------------------------------
revoke all on function
  public.drive_claim(int, uuid), public.drive_mark_transferred(uuid, text, bigint),
  public.drive_mark_failed(uuid, text), public.drive_release(uuid),
  public.admin_drive_status(), public.admin_drive_retry(uuid)
  from public, anon, authenticated;

grant execute on function
  public.drive_claim(int, uuid), public.drive_mark_transferred(uuid, text, bigint),
  public.drive_mark_failed(uuid, text), public.drive_release(uuid)
  to service_role;

grant execute on function public.admin_drive_status(), public.admin_drive_retry(uuid) to authenticated;
