-- Retour arrière de 0005_drive_sync.sql. Ne touche à aucune photo ni à aucun fichier Storage.
-- Les fichiers déjà copiés sur Google Drive ne sont PAS supprimés (à faire à la main si besoin).
drop function if exists public.admin_drive_retry(uuid);
drop function if exists public.admin_drive_status();
drop function if exists public.drive_release(uuid);
drop function if exists public.drive_mark_failed(uuid, text);
drop function if exists public.drive_mark_transferred(uuid, text, bigint);
drop function if exists public.drive_claim(int, uuid);
drop index if exists public.photos_drive_queue_idx;
alter table public.photos drop constraint if exists photos_drive_transferred_has_file;
alter table public.photos drop constraint if exists photos_drive_sync_status_check;
alter table public.photos
  drop column if exists drive_bytes, drop column if exists drive_locked_at, drop column if exists drive_sync_attempts,
  drop column if exists drive_sync_error, drop column if exists drive_synced_at, drop column if exists drive_sync_status,
  drop column if exists drive_file_id;
