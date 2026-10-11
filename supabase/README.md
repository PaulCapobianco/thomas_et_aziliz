# Supabase : mise en place, contrat d'API et tests

Tout ce dossier est **prêt à appliquer**. Les migrations et les tests SQL ont été exécutés sur un vrai PostgreSQL 16
(avec un stub qui imite les rôles et le schéma `storage` de Supabase). Ils n'ont **pas** été exécutés sur un projet
Supabase réel : voir « Vérification n°1 » ci-dessous.

```
supabase/
  migrations/0001_schema.sql        tables, index, RLS, droits de colonnes
  migrations/0002_functions.sql     toutes les écritures sensibles (RPC) + fonctions admin
  migrations/0003_rls_storage.sql   bucket privé "photos" + policies Storage
  tests/00_stub_supabase.sql        stub LOCAL uniquement (ne jamais l'exécuter sur Supabase)
  tests/10_tests.sql                117 assertions (RLS, droits, statuts, doublons, pagination, admin)
  tests/run_local.sh                lance tout + test de concurrence déterministe (T12)
  optional/plan_b_*                 plan de secours si la vérification n°1 échoue
  functions/upload-url/index.ts     Edge Function du plan B (NON TESTÉE)
```

## 1. Appliquer sur Supabase (action humaine, ~20 min)

1. Créer un projet (région Europe). Noter le mot de passe de la base.
2. **SQL Editor** : coller puis lancer, dans l'ordre, `0001_schema.sql`, `0002_functions.sql`, `0003_rls_storage.sql`.
   Résultat attendu pour chacun : `Success. No rows returned`. Les trois fichiers sont rejouables sans risque.
3. **Authentication > Users > Add user** : e-mail + mot de passe, cocher *Auto Confirm User*.
   **Authentication > Sign In / Providers** : désactiver *Allow new users to sign up* (personne d'autre ne doit pouvoir créer de compte).
4. Déclarer l'admin (SQL Editor) — une ligne par administrateur (vous, le témoin) :
   ```sql
   insert into public.admin_users (user_id) select id from auth.users where email = 'ADRESSE_ADMIN' on conflict do nothing;
   ```
   Résultat attendu : `INSERT 0 1`.
5. **Project Settings > API** : copier *Project URL* et la clé *anon / publishable* (publique, sans danger) dans la configuration du site.
   Ne copiez JAMAIS la clé `service_role` / `sb_secret_...` dans le site.

## 2. Vérification n°1 sur le vrai Supabase (5 min) — À FAIRE AVANT TOUT LE RESTE

Le modèle suppose qu'un invité anonyme peut **déposer** un fichier (policy INSERT seule, sans SELECT).
PostgreSQL refuse un `INSERT ... RETURNING *` si aucune policy SELECT ne laisse voir la ligne (c'est ce que montrent
les tests `T19-*-s1b` en local). Si l'API Storage de Supabase fait un tel `RETURNING` pour un dépôt sans `upsert`,
le dépôt échouera avec `new row violates row-level security policy`. Je n'ai pas pu le vérifier sans projet réel.

Dans la console du navigateur (n'importe quelle page où `supabase-js` est chargé), remplacer `URL` et `KEY` :

```js
const sb = supabase.createClient('URL', 'KEY');
const id = crypto.randomUUID();
const jpeg = Uint8Array.from(atob('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDMooormOo//9k='), c => c.charCodeAt(0));
const blob = new Blob([jpeg], { type: 'image/jpeg' });
const path = `public/thumbs/${id}.jpg`;

console.log('A dépôt            ', await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false }));
console.log('B lecture (refus)  ', await sb.storage.from('photos').createSignedUrl(path, 60));
console.log('C liste (vide)     ', await sb.storage.from('photos').list('public/thumbs'));
console.log('D rpc publique     ', await sb.rpc('check_duplicates', { p_audience: 'public', p_hashes: [] }));
console.log('E rpc admin (refus)', await sb.rpc('admin_status'));
```

| Test | Résultat attendu | Si autre chose |
|---|---|---|
| A | `error: null` | `new row violates row-level security policy` => **appliquer le plan B** (section 5) |
| B | `error` « Object not found » (un fichier non publié ne se signe pas) | si une URL est renvoyée : **STOP, fuite**, ne pas mettre en production |
| C | `data: []` | si la liste contient des fichiers : **STOP, fuite** |
| D | `data: []`, `error: null` | vérifier que 0002 a été exécuté |
| E | `error` avec code `42501` ou « permission denied » | si des données sont renvoyées : **STOP** |

Le fichier de test déposé en A reste en base de stockage sans ligne `photos` : il apparaîtra dans `admin_orphans()` après 30 min.

## 3. Contrat d'API pour le code du site (supabase-js v2)

Identité navigateur : `uploaderId = reporterId = localStorage['wk_uid']` (UUID généré une fois ; repli : UUID en mémoire).
Ce n'est pas une identité de personne.

| Besoin | Appel | Résultat |
|---|---|---|
| Doublons avant envoi | `sb.rpc('check_duplicates', { p_audience, p_hashes: [sha256…] })` | tableau des empreintes déjà présentes (≤ 200) |
| Envoi d'une photo | 1) `sb.storage.from('photos').upload('<aud>/thumbs/<id>.jpg', thumb, { contentType:'image/jpeg', upsert:false })` puis 2) idem pour `<aud>/full/<id>.jpg` puis 3) `sb.rpc('register_photo', { p_id, p_audience, p_sha256, p_uploader, p_nsfw })` | `{ result: 'published' \| 'pending_review' \| 'duplicate' \| 'rate_limited' \| 'registered' }` ; erreur si un fichier manque (`P0002`), est trop gros ou n'est pas un JPEG (`22023`) |
| Galerie publique | `sb.rpc('gallery_page', { p_limit: 48, p_before_published, p_before_id })` puis `sb.storage.from('photos').createSignedUrls(thumb_paths, 3600)` | lignes `{ id, full_path, thumb_path, published_at }` ; page suivante = dernière ligne reçue |
| Photo en grand | `createSignedUrl(full_path, 3600)` | URL valable 1 h |
| Téléchargement | `createSignedUrl(full_path, 3600, { download: 'photo-mariage.jpg' })` | l'option `download` force l'enregistrement (l'attribut HTML `download` est ignoré sur une autre origine) |
| Signaler | `sb.rpc('report_photo', { p_photo_id, p_reporter, p_reason })` (`'embarrassing' \| 'child' \| 'other'`) | `reported \| already_reported \| not_found \| rate_limited` |
| Admin : liste | `sb.rpc('admin_list_photos', { p_filter: 'reported'\|'pending'\|'hidden'\|'recent'\|'maries', p_limit, p_offset })` | + `createSignedUrls` (l'admin lit tout) |
| Admin : action | `sb.rpc('admin_set_status', { p_id, p_status: 'hidden'\|'published'\|'deleted' })` | puis, pour `deleted`, `storage.remove([full_path, thumb_path])` |
| Admin : pause | `sb.rpc('admin_set_paused', { p_paused })`, `sb.rpc('admin_release_pending', { p_reason: 'paused'\|'model_unavailable' })` | |
| Admin : état | `sb.rpc('admin_status')` | `{ paused, published, reported, pending, hidden, maries, storage_bytes, storage_objects }` |
| Admin : orphelins | `sb.rpc('admin_orphans')` | fichiers sans ligne, à supprimer via `storage.remove` |

`p_nsfw` : `'clean' | 'suspect' | 'unavailable'` pour l'envoi public ; `'skipped'` pour l'envoi « mariés uniquement ».
Le serveur décide du statut : un client ne peut pas publier directement une photo suspecte ou non vérifiée, mais peut
mentionner `'clean'` à tort (NSFWJS est une aide préventive ; le filet réel = signalements + admin).

Ordre d'envoi : générer un nouvel `id` à chaque tentative (pas de réutilisation après un échec). Les fichiers d'une
tentative interrompue deviennent des orphelins nettoyés par l'admin.

## 4. Lancer les tests en local (aucun accès à Supabase nécessaire)

Prérequis : PostgreSQL 14+ et `psql`.

```bash
docker run --rm -d --name pgtest -e POSTGRES_PASSWORD=pg -p 5433:5432 postgres:16
PGHOST=localhost PGPORT=5433 PGUSER=postgres PGPASSWORD=pg supabase/tests/run_local.sh
```

Sortie : un tableau `PASS/FAIL` par test + `T12` (concurrence). Code retour 1 s'il y a un FAIL.
Vérifié : le test de concurrence **échoue** quand on retire le verrou `for update` de `report_photo` ;
les tests de droits **échouent** quand on retire un `revoke` ou qu'on supprime le filtre `status = 'published'`.
Sans PostgreSQL disponible, déclarer ces tests `NON_TESTÉ`, jamais `PASS`.

Limites du stub : il ne reproduit pas le comportement de l'API Storage (signatures, URLs, `RETURNING`), ni les
rôles réels de Supabase (`postgres`, `supabase_storage_admin`). Les fonctions `SECURITY DEFINER` supposent que le rôle
propriétaire (`postgres`) contourne la RLS, ce qui est le cas sur Supabase.

## 5. Plan B si la vérification n°1 échoue (test A)

Les invités ne déposent plus directement : une Edge Function délivre des **URL d'envoi signées** après avoir validé le chemin.
1. `supabase/optional/plan_b_drop_guest_insert.sql` : supprime la policy `photos_guest_insert` (plus aucun accès anonyme en écriture sur Storage).
2. Déployer `supabase/functions/upload-url/index.ts` (Dashboard > Edge Functions, ou `supabase functions deploy upload-url`).
   Si les nouvelles clés « publishable » sont utilisées, ajouter `--no-verify-jwt` au déploiement.
3. Côté site : appeler la fonction avec `{ paths: [thumbPath, fullPath] }`, puis `sb.storage.from('photos').uploadToSignedUrl(path, token, blob, { contentType: 'image/jpeg' })`.
Le reste (RPC, galerie, signalements, admin) ne change pas. Code **non testé** : à valider par un vrai envoi.

## 6. Ce que cette conception garantit… et ne garantit pas

- Garanti (testé en local) : un invité ne lit ni les photos privées, ni les photos en attente, ni les photos masquées, ni
  `original_sha256`, `uploader_id`, signalements, réglages ; il ne peut ni changer un statut, ni voter directement, ni se déclarer admin.
- Non garanti : une URL signée déjà délivrée reste valable 1 h après un masquage ; un navigateur peut l'avoir en cache.
- Non garanti : « deux signalements » = deux identifiants de navigateur, pas deux personnes.
- Non garanti : un client modifié peut déposer des fichiers (JPEG ≤ 3 Mo, chemins valides) jusqu'à saturer le quota ;
  surveiller `admin_status().storage_bytes` et le quota Supabase.
