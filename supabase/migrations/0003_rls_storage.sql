-- =====================================================================
-- 0003_rls_storage.sql : bucket PRIVÉ unique + policies Storage
-- Idempotent. À exécuter après 0001 et 0002.
--
-- Modèle : un seul bucket privé "photos", chemins  <audience>/<full|thumbs>/<uuid>.jpg
--   - Les invités peuvent UNIQUEMENT déposer (INSERT) des fichiers au bon format de chemin.
--   - Les invités ne peuvent LIRE (donc obtenir une URL signée) que les photos publiques publiées.
--   - L'admin (table admin_users) peut tout lire et supprimer.
--   - Retirer une photo = changer son statut en base ; plus aucune nouvelle URL signée n'est délivrée.
--     Une URL signée déjà délivrée reste valable jusqu'à son expiration (1 h) : pas de révocation magique.
-- =====================================================================

-- Bucket privé, JPEG uniquement, 3 Mo max par fichier (full 1600 px ~ 300-600 Ko ; thumb ~ 20-50 Ko).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 3145728, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Dépôt : écriture seule, chemin strictement contrôlé (pas de dossier arbitraire, pas d'écrasement : pas de UPDATE/SELECT)
drop policy if exists photos_guest_insert on storage.objects;
create policy photos_guest_insert on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'photos'
    and name ~ '^(public|maries)/(full|thumbs)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
  );

-- Lecture invités : seulement les fichiers d'une photo publique PUBLIÉE
drop policy if exists photos_public_read on storage.objects;
create policy photos_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'photos' and public.object_is_public(name));

-- Lecture admin : tout (photos privées, en attente, masquées) pour l'interface d'administration
drop policy if exists photos_admin_read on storage.objects;
create policy photos_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and public.is_admin());

-- Suppression : admin uniquement (via storage.remove, après admin_set_status(..., 'deleted'))
drop policy if exists photos_admin_delete on storage.objects;
create policy photos_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and public.is_admin());

-- Aucune policy UPDATE : personne ne peut remplacer un fichier existant.
