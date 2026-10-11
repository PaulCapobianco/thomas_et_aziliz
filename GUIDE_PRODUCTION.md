# Guide de mise en production — 4 séances, dans cet ordre

Remplace l'ordre dispersé de ACTIONS_HUMAINES / README_DEPLOIEMENT (qui restent la référence détaillée). Durée totale
≈ 2 h 30, répartie en quatre séances. Tout ce qui ne demande pas votre présence est déjà fait ou se fait en une commande.

Légende : 🧑 = vous seul (compte, argent, téléphone) · 💻 = commande à copier-coller (je peux la lancer si vous me donnez l'URL et la clé publique).

**Ce qui est déjà prouvé** (voir CHECKLIST_TESTS) : les migrations, le Storage (dépôt anonyme sans compte, lecture refusée sur
privé/suspect/masqué, URL signées, limites 3 Mo / JPEG), les droits RPC, les votes simultanés et les doublons simultanés ont été
exécutés en HTTP réel contre l'image officielle `supabase/storage-api` + PostgREST + PostgreSQL (`npm run test:real`).
**Ce qui ne l'est pas** : votre projet Supabase hébergé, Auth (GoTrue), l'hébergeur, les vrais téléphones. Les séances 1 à 4 le prouvent.

---

## Séance 1 — Supabase (≈ 40 min, avant le 15 octobre) 🧑

1. https://supabase.com/dashboard > **New project**, région **Europe (Paris ou Francfort)**, mot de passe de base dans votre
   gestionnaire de mots de passe.
2. **Organization > Billing** : décider de l'offre. Recommandation : **Pro** pour octobre (quota stockage/trafic ; l'offre
   gratuite met le projet en pause après 7 jours sans activité et coupe au quota). **Vous seul validez cette dépense**, à
   résilier après le mariage.
3. 💻 Préparer un seul fichier SQL à coller (une seule requête, ordre garanti) :
   ```bash
   cd KIT_CODEX_MARIAGE_V3
   cat supabase/migrations/0001_schema.sql supabase/migrations/0002_functions.sql supabase/migrations/0003_rls_storage.sql > /tmp/migrations.sql
   ```
   Ouvrir `/tmp/migrations.sql`, tout copier, **SQL Editor > New query > Run**. Attendu : `Success. No rows returned`.
4. **Storage > photos** : *Private*, taille max 3 MB, type `image/jpeg`.
5. **Authentication > Sign In / Providers** : désactiver **Allow new users to sign up** ; laisser *Anonymous sign-ins* désactivé.
6. **Authentication > Users > Add user** : votre compte et celui du témoin (mot de passe fort et distinct, *Auto Confirm User*).
7. **SQL Editor** (une exécution, remplacez les deux adresses) :
   ```sql
   insert into public.admin_users (user_id)
   select id from auth.users where email in ('VOTRE@EMAIL', 'TEMOIN@EMAIL') on conflict do nothing;
   ```
   Attendu : `INSERT 0 2`.
8. **Project Settings > API** : copier **Project URL** et la clé **anon / publishable**. Jamais `service_role` ni `sb_secret_…`.
9. Me transmettre l'URL et la clé publique (ou les coller vous-même dans `config.js`, constantes `SUPABASE_URL` et `SUPABASE_KEY`).

## Séance 2 — Vérifications réelles (≈ 20 min) 💻

À lancer sur le projet **vide** (avant tout envoi réel), après avoir renseigné `config.js` :

```bash
npm ci
node scripts/verify-storage.mjs --test-project      # attendu : A, B, C, D, E = PASS, code retour 0
```

- **A FAIL** (`row-level security`) : ne pas relâcher SELECT. Le test local avec le vrai moteur Storage donne PASS, donc
  vérifier d'abord que 0003 a bien été exécuté ; sinon plan B (supabase/README.md §5).
- **B ou C ou E donnent accès** : STOP, ne pas diffuser le QR.

Puis, toujours 💻 :
```bash
npm run vendor && npm run check && npm run build
```
Un fichier `dist/` est produit : c'est le seul dossier à publier.

## Séance 3 — Hébergement HTTPS et QR (≈ 30 min) 🧑

1. **Cloudflare Pages** (ou Netlify) > nouveau projet > **Direct Upload** > glisser le dossier `dist/`. HTTPS est automatique.
   Pas de domaine payant nécessaire (`xxx.pages.dev` convient).
2. 💻 Vérifier les en-têtes réellement servis (remplacer l'URL) :
   ```bash
   curl -sI https://VOTRE-SITE/ | grep -iE "content-security|x-robots|referrer|cache-control|x-frame"
   curl -s https://VOTRE-SITE/config.js | head -3          # URL Supabase présente, aucune clé secrète
   curl -s https://VOTRE-SITE/robots.txt
   ```
   Attendu : CSP, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`. Pour `Cache-Control`, une valeur
   mêlant `max-age=300` et `no-cache` est acceptable ; le comportement de fusion de `_headers` n'a pas pu être vérifié
   sans l'hébergeur : un rechargement forcé suffit après un déploiement.
3. **Authentication > URL Configuration** : Site URL = l'URL du site.
4. Ouvrir `https://VOTRE-SITE/admin.html`, se connecter avec chaque compte admin : les compteurs s'affichent. Tester aussi un
   compte non listé dans `admin_users` (créer temporairement un utilisateur) : refus attendu.
5. Générer le QR de l'URL (sans `?k=`, `SECRET` reste vide : l'accès ne dépend pas d'un secret dans l'URL), l'imprimer en
   épreuve, le scanner avec deux téléphones.

## Séance 4 — Recette sur téléphones réels (≈ 45 min, avant le 24) 🧑

iPhone (Safari) **et** Android (Chrome), sur le site de la séance 3 :

1. Scanner le QR, ouvrir « Partager », envoyer 3 photos prises avec l'appareil (dont une photo **iPhone native** et une verticale).
   Attendu : aperçus, « Ajoutée à la galerie », miniatures visibles, orientation correcte, photo en grand + téléchargement.
2. Renvoyer une photo exactement identique : « Déjà envoyée, ignorée ». Envoyer une photo proche mais différente : acceptée.
3. Envoyer une photo en **privé (mariés)** : absente de la galerie, y compris en navigation privée sur un autre téléphone.
4. Mode avion pendant un envoi de plusieurs photos : aucun faux « envoyé », bouton « Réessayer », puis réussite.
5. Signaler une photo depuis deux téléphones différents : 1er signalement = visible, 2e = disparue de la galerie.
6. Admin sur téléphone : voir les signalées, **restaurer**, **masquer**, **suspendre / reprendre**, puis un envoi public
   pendant la pause (doit être « reçue, apparaîtra après validation »), puis libérer.
7. Photo « privée » et photo « en attente » : recopier leurs chemins (SQL Editor : `select full_path, thumb_path, status from
   public.photos order by created_at desc limit 10;`) puis 💻
   `node scripts/verify-storage.mjs --test-project --denied-path=maries/full/UUID.jpg --denied-path=public/full/UUID_EN_ATTENTE.jpg`
   → **F = PASS** pour chaque chemin.
8. **Usage / Billing** : vérifier stockage et trafic ; faire la mesure de capacité avec 20–50 vraies photos
   (`python3 scripts/estimate_storage.py DOSSIER_PHOTOS`).
9. Supprimer les photos de test avant le mariage (Admin > Supprimer ; vérifier ensuite Storage > photos, ou supprimer les
   dossiers d'essai à la main dans le Dashboard).
10. Remplir la section « À remplir lors de la recette humaine » de CHECKLIST_TESTS (appareil, date, PASS/FAIL).

## Calendrier

| Date | Action |
|---|---|
| ≤ 15 oct | Séance 1 + 2 |
| ≤ 20 oct | Séance 3, prénoms / photo dans `config.js` (facultatif) |
| ≤ 24 oct | Séance 4 |
| 25 oct | Feu vert, gel des fonctions, GUIDE_TEMOIN + identifiants au témoin |
| 26–27 oct | Corrections critiques seulement |
| 29 oct | Vérifier : site, admin, quota, projet non en pause |
