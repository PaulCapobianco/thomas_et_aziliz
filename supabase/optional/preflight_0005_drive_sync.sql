-- Read-only hosted-project preflight. Run in the Supabase SQL Editor before approving 0005.
-- Share aggregate results only; this script does not change any row or schema object.
begin transaction read only;

select current_database() as database_name,
       current_setting('server_version') as postgres_version,
       to_regclass('public.photos') is not null as photos_exists,
       to_regclass('storage.objects') is not null as storage_exists;

select name, default_version, installed_version
  from pg_available_extensions
 where name in ('pg_cron', 'pg_net', 'supabase_vault')
 order by name;

select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'photos'
   and column_name in ('id', 'audience', 'status', 'full_path', 'created_at',
                       'drive_file_id', 'drive_sync_status', 'drive_synced_at',
                       'drive_sync_error', 'drive_sync_attempts', 'drive_locked_at', 'drive_bytes')
 order by column_name;

select proname, pg_get_function_identity_arguments(p.oid) as arguments
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and proname in ('is_admin', 'drive_claim', 'drive_queue_size',
                   'drive_mark_transferred', 'drive_mark_failed', 'drive_release',
                   'admin_drive_status', 'admin_drive_retry')
 order by proname;

select count(*) as total_photos,
       count(*) filter (where status <> 'deleted') as active_photos,
       count(*) filter (where audience = 'public') as public_photos,
       count(*) filter (where audience = 'maries') as private_photos
  from public.photos;

select id, public, file_size_limit, allowed_mime_types
  from storage.buckets where id = 'photos';

commit;
