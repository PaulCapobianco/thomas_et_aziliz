-- =====================================================================
-- 0001_schema.sql : tables, index, RLS des tables, droits de colonnes
-- Idempotent (peut être relancé sans casser). Aucune suppression de données.
-- À exécuter dans Supabase > SQL Editor (rôle postgres), dans l'ordre 0001 -> 0002 -> 0003.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Table des photos : SOURCE DE VÉRITÉ (statut, audience, ordre de la galerie)
-- ---------------------------------------------------------------------
create table if not exists public.photos (
  id              uuid primary key,   -- généré par le navigateur (crypto.randomUUID()), repris dans les chemins Storage
  audience        text not null check (audience in ('public', 'maries')),
  status          text not null check (status in ('published', 'pending_review', 'hidden', 'deleted')),
  -- Pourquoi la photo n'est pas (ou plus) publiée. NULL quand status = 'published'.
  --   pending_review : 'nsfw' | 'paused' | 'model_unavailable'
  --   hidden         : 'reports' | 'admin'
  review_reason   text check (review_reason in ('nsfw', 'paused', 'model_unavailable', 'reports', 'admin')),
  full_path       text not null,      -- <audience>/full/<id>.jpg   (bucket 'photos')
  thumb_path      text not null,      -- <audience>/thumbs/<id>.jpg
  original_sha256 text not null check (original_sha256 ~ '^[0-9a-f]{64}$'),
  uploader_id     uuid not null,      -- UUID du navigateur (localStorage). N'identifie PAS une personne.
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  published_at    timestamptz,        -- date de mise en ligne publique (sert au tri de la galerie)
  constraint photos_paths_match check (
    full_path  = audience || '/full/'   || id::text || '.jpg' and
    thumb_path = audience || '/thumbs/' || id::text || '.jpg'
  )
);

-- Anti-doublon EXACT par destination ; une photo supprimée libère son empreinte.
create unique index if not exists photos_dedupe_idx
  on public.photos (audience, original_sha256) where status <> 'deleted';
create unique index if not exists photos_full_path_idx  on public.photos (full_path);
create unique index if not exists photos_thumb_path_idx on public.photos (thumb_path);
-- Pagination de la galerie publique (keyset) : (published_at desc, id desc)
create index if not exists photos_gallery_idx
  on public.photos (published_at desc, id desc) where audience = 'public' and status = 'published';
create index if not exists photos_uploader_idx on public.photos (uploader_id, created_at);
create index if not exists photos_admin_idx    on public.photos (status, created_at desc);

-- ---------------------------------------------------------------------
-- Signalements (jamais lisibles par les invités)
-- ---------------------------------------------------------------------
create table if not exists public.photo_reports (
  id          uuid primary key default gen_random_uuid(),
  photo_id    uuid not null references public.photos (id) on delete cascade,
  reporter_id uuid not null,          -- UUID du navigateur : "deux signalements", pas "deux personnes certifiées"
  reason      text check (reason in ('embarrassing', 'child', 'other')),
  created_at  timestamptz not null default now(),
  unique (photo_id, reporter_id)
);
create index if not exists photo_reports_photo_idx    on public.photo_reports (photo_id, created_at);
create index if not exists photo_reports_reporter_idx on public.photo_reports (reporter_id, created_at);

-- ---------------------------------------------------------------------
-- Réglages (ex. pause des nouvelles publications publiques) et admins
-- ---------------------------------------------------------------------
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (key, value) values ('publications_paused', 'false'::jsonb)
  on conflict (key) do nothing;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade
);

-- ---------------------------------------------------------------------
-- updated_at automatique
-- ---------------------------------------------------------------------
create or replace function public.tg_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists photos_set_updated_at on public.photos;
create trigger photos_set_updated_at before update on public.photos
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- RLS + droits : par défaut, personne (anon / authenticated) ne touche aux tables.
-- Supabase accorde TOUS les droits par défaut sur les nouvelles tables : on les retire explicitement.
-- ---------------------------------------------------------------------
alter table public.photos        enable row level security;
alter table public.photo_reports enable row level security;
alter table public.app_settings  enable row level security;
alter table public.admin_users   enable row level security;

revoke all on public.photos, public.photo_reports, public.app_settings, public.admin_users
  from anon, authenticated;

-- Seule lecture ouverte : métadonnées MINIMALES des photos publiées publiques.
-- original_sha256, uploader_id, review_reason, created_at ne sont jamais lisibles côté client.
grant select (id, audience, status, full_path, thumb_path, published_at)
  on public.photos to anon, authenticated;

drop policy if exists photos_public_read on public.photos;
create policy photos_public_read on public.photos
  for select to anon, authenticated
  using (audience = 'public' and status = 'published');

-- Aucune policy INSERT / UPDATE / DELETE : toutes les écritures passent par les fonctions du fichier 0002.
-- photo_reports, app_settings, admin_users : RLS active, aucune policy => inaccessibles aux clients.
