-- PLAN B (à n'appliquer que si la vérification n°1 du README échoue au test A).
-- Retire le droit de dépôt anonyme direct : les envois passent alors par la Edge Function "upload-url"
-- (URL d'envoi signées). Les lectures et le reste du modèle ne changent pas.
drop policy if exists photos_guest_insert on storage.objects;
