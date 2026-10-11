-- =====================================================================
-- STUB SUPABASE POUR TESTS LOCAUX UNIQUEMENT.
-- NE JAMAIS EXÉCUTER SUR UN PROJET SUPABASE. Sert à faire tourner les migrations et les tests
-- sur un PostgreSQL ordinaire (ex. docker run postgres:16) en imitant : rôles anon/authenticated,
-- auth.uid(), storage.buckets, storage.objects (RLS activée), et les droits par défaut permissifs de Supabase.
-- =====================================================================
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon')          then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);

-- auth.uid() lit le claim "sub" comme le fait PostgREST
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table storage.objects enable row level security;

grant usage on schema public, auth, storage to anon, authenticated;
grant all on storage.objects, storage.buckets to anon, authenticated;   -- comme Supabase : la RLS fait le tri
grant execute on function auth.uid() to anon, authenticated;

-- Droits par défaut de Supabase : TOUT pour anon/authenticated sur les nouveaux objets du schéma public.
-- C'est précisément ce que les migrations doivent corriger (revoke) : on le reproduit pour que les tests le prouvent.
alter default privileges in schema public grant all on tables    to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
