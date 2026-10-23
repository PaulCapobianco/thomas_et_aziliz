# Sauvegarde des photos sur Google Drive — phase 1 (copie, sans rien supprimer)

État : **code et tests locaux prêts, rien n'est déployé, aucune migration appliquée, aucun secret créé.**

## 1. Ce que fait la phase 1

Chaque photo (publique **ou** « Mariés uniquement ») envoyée par un invité est **copiée** de Supabase Storage vers un Drive privé,
en arrière-plan. La copie ne change rien d'autre : ni statut, ni modération, ni galerie, ni interface invités, ni QR code.

```
Invité ──► Supabase Storage + register_photo  (inchangé : c'est ce qui confirme l'envoi à l'invité)
                   │
 cron (1/min) ou bouton admin ──► Cloudflare Pages Function  POST /api/drive-sync
                   │                 1. jeton Google renouvelé   2. espace Drive vérifié
                   │                 3. photos réservées (drive_claim, sans doublon possible)
                   │                 4. téléchargement Supabase → envoi Drive → taille + MD5 comparés
                   └──────────────►  5. drive_mark_transferred  (sinon drive_mark_failed + erreur conservée)
```

- Statuts (`photos.drive_sync_status`) : `pending` → `processing` → `transferred` / `failed`. Réessais automatiques jusqu'à 6 fois, avec un délai croissant ; l'admin peut relancer.
- **Anti-doublon** : chaque fichier Drive porte la propriété `photoId`. Après une réponse perdue, le réessai retrouve le fichier au lieu d'en créer un second.
- **Aucune suppression** (ni Supabase, ni Drive) : les fichiers sources restent en place quel que soit le résultat.
- Interrupteur : sans `DRIVE_SYNC_ENABLED=true`, l'endpoint répond 503 et ne fait rien.

## 2. Pourquoi pas tout de suite le WebP / 1600 px / 2560 px demandé ? (décision à prendre)

Le site compresse **déjà dans le navigateur** : JPEG 3000 px q0,90 (grand format) + 640 px q0,84 (miniature). Les originaux ne sont conservés nulle part.
Passer au pipeline cible (Drive 2560 px WebP q85-90 ; galerie 1600 px WebP q72 + miniature 400 px ; rien de public pour les privées) exige de modifier
`uploads.js`, le bucket (JPEG uniquement, 3 Mo), `register_photo` (exige 2 JPEG), la galerie, l'admin et l'export ZIP. C'est faisable, mais :

1. **Impossible côté serveur** : un Worker gratuit n'a que 10 ms de CPU, sans canvas ni décodeur d'image. La conversion doit rester dans le navigateur.
2. **Safari / iPhone ne sait pas encoder en WebP** (`canvas.toBlob('image/webp')` renvoie du PNG). Il faudrait détecter et retomber sur du JPEG pour la majorité des invités ; le gain de place serait donc partiel.
3. **Les photos « mariés » n'auraient plus de copie Supabase** : l'admin, l'export ZIP et la modération ne les verraient plus qu'une fois sur Drive.
4. Mariage le 29 octobre (vos documents internes disent encore le 31 : à corriger), gel des fonctions initialement prévu le 25 : **trop de surface modifiée pour 6 jours**.

**Recommandation** : phase 1 maintenant (sécurité des originaux sur Drive, zéro changement côté invités) ; phase 2 (WebP/1600 px, nettoyage des copies Supabase) **après le mariage**, avec votre accord. En attendant, le grand format JPEG 3000 px q0,90 envoyé sur Drive est de qualité **supérieure** à la cible (2560 px q85-90) ; le coût est du stockage Drive (≈ 600 Ko/photo : 5 000 photos ≈ 3 Go sur 15 Go).

## 3. Limites Google / Cloudflare qui ont dicté le design

| Sujet | Constat | Conséquence |
|---|---|---|
| Compte de service | N'a **pas de quota** sur un Drive personnel (`storageQuotaExceeded`) ; il faudrait un Drive partagé (Workspace) | **OAuth avec votre compte**, jeton de rafraîchissement stocké côté Cloudflare |
| Jeton OAuth en mode « Test » | Le refresh token **expire après 7 jours** ([doc Google](https://developers.google.com/health/setup)) | Passer l'application OAuth en **« En production »** (gratuit, sans vérification pour un usage personnel) **avant** de créer le jeton |
| Portée | `drive.file` : l'application ne voit que les fichiers qu'elle a elle-même créés | Les dossiers sont créés par le script `drive-setup`, pas à la main |
| Envoi quotidien | 750 Go/jour (donnée officielle Workspace, [limites Drive](https://developers.google.com/drive/api/guides/limits)) | Sans objet pour quelques Go |
| Cadence API | Quotas par minute, pas de plafond quotidien | 429 → arrêt du lot, photos remises en file sans consommer d'essai |
| Workers gratuit | 10 ms CPU, **50 sous-requêtes** par appel, 100 000 requêtes/jour ([doc](https://developers.cloudflare.com/workers/platform/pricing/)) | Lots de 6 photos (≈ 5 sous-requêtes chacune), testé ≤ 50 ; l'envoi lui-même est de l'attente réseau, pas du CPU |
| Pas de cron sur Pages | Les Pages Functions n'ont pas de déclencheur planifié | Appel planifié par `pg_cron` côté Supabase (§6) ou bouton admin |
| Espace Drive | `about.get` avant chaque lot | Moins de 500 Mo libres → le lot ne démarre pas, rien n'est réservé ; Drive plein pendant l'envoi → lot remis en file |

## 4. Variables d'environnement (Cloudflare Pages, projet `thomas-aziliz-mariage`)

Toutes en **secrets** : `npx wrangler pages secret put NOM --project-name thomas-aziliz-mariage`. Aucune n'est dans le navigateur, ni dans Git, ni dans `dist/`.

| Nom | Valeur |
|---|---|
| `DRIVE_SYNC_ENABLED` | `true` pour activer ; absent/autre = désactivé |
| `SUPABASE_URL` | URL du projet (déjà publique dans `config.js`) |
| `SUPABASE_PUBLISHABLE_KEY` | clé publique `sb_publishable_…` (vérifie que l'appelant est admin) |
| `SUPABASE_SERVICE_ROLE_KEY` | clé `service_role` / `sb_secret_…` : **uniquement** ce secret Cloudflare |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | client OAuth « Application de bureau » |
| `GOOGLE_REFRESH_TOKEN` | produit par `scripts/drive-auth.mjs` |
| `DRIVE_FOLDER_PUBLIC`, `DRIVE_FOLDER_PRIVATE` | produits par `scripts/drive-setup.mjs` |
| `SYNC_SECRET` | longue chaîne aléatoire pour l'appel planifié (`openssl rand -hex 32`) |
| `DRIVE_BATCH` | optionnel, photos par appel (défaut 6, maximum 8) |

## 5. Configuration Google Cloud / Drive (≈ 20 min, vous seul)

1. https://console.cloud.google.com → nouveau projet « mariage-photos ».
2. **API et services > Bibliothèque** : activer **Google Drive API**.
3. **Écran de consentement OAuth** : type *Externe*, nom de l'application, votre adresse. Portée : `…/auth/drive.file`. **Cliquer « Publier l'application » (statut « En production »)** — sinon le jeton expire en 7 jours. L'avertissement « application non validée » à la connexion est normal (usage personnel) : *Paramètres avancés > Continuer*.
4. **Identifiants > Créer > ID client OAuth > Application de bureau**. Noter l'ID et le secret.
5. En local : `GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… node scripts/drive-auth.mjs`, ouvrir l'URL, accepter ; copier le jeton affiché.
6. En local : `GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… GOOGLE_REFRESH_TOKEN=… node scripts/drive-setup.mjs` (**une seule fois**) : crée « Mariage Thomas & Aziliz » avec « Photos publiques » et « Photos privées - Mariés uniquement » (privés, jamais partagés) et affiche les deux identifiants.
7. Enregistrer les secrets du §4.

## 6. Mise en service (après votre accord, dans cet ordre)

1. **Migration** `supabase/migrations/0005_drive_sync.sql` dans le SQL Editor (additive, rejouable). Les photos existantes passent en `pending` : elles seront **copiées** (jamais modifiées).
2. Déployer le site (`npm run deploy`) : le dossier `functions/` est publié avec `dist/`. Tant que `DRIVE_SYNC_ENABLED` n'est pas `true`, rien ne se passe.
3. Test à blanc : activer, ouvrir l'admin (une ligne « Sauvegarde Google Drive » apparaît), bouton « Lancer la sauvegarde Drive maintenant », vérifier dans Drive.
4. Automatiser (SQL Editor Supabase ; le secret est stocké dans `cron.job`, accessible aux seuls administrateurs de la base) :
   ```sql
   create extension if not exists pg_cron; create extension if not exists pg_net;
   select cron.schedule('drive-sync', '* * * * *', $$
     select net.http_post(url := 'https://thomas-aziliz-mariage.pages.dev/api/drive-sync',
                          headers := '{"x-sync-secret":"VOTRE_SYNC_SECRET","content-type":"application/json"}'::jsonb,
                          body := '{}'::jsonb) $$);
   ```
   Sans cron, le bouton admin suffit (la copie n'est alors pas continue).

## 7. Retour arrière

1. `DRIVE_SYNC_ENABLED` : supprimer le secret (ou `false`) → plus aucun appel Google. Immédiat.
2. `select cron.unschedule('drive-sync');`
3. Optionnel : `supabase/optional/rollback_0005_drive_sync.sql` supprime les colonnes et fonctions Drive. Les photos, fichiers Storage, policies et la modération ne sont pas touchés ; les copies déjà sur Drive restent (à supprimer à la main).
4. Le site fonctionne à l'identique sans aucune de ces pièces (l'admin masque seul la ligne Drive si la migration est absente).

## 8. Résultats des tests (locaux, sans secret ni accès réseau)

| Commande | Résultat |
|---|---|
| `npm run test:sql` (PostgreSQL 16 jetable) | **tous PASS** : anciens tests inchangés + T40 (0005 sur données existantes, rien perdu), T41-T50 (file sans doublon, statuts, délais/plafond de réessais, droits anon/non-admin refusés, colonnes Drive illisibles pour les invités, relance admin) |
| `npm run test:drive` | **14/14 PASS** : copie publique + privée dans le bon dossier avec taille+MD5 vérifiés ; jeton invalide ; Drive 503 ; réponse perdue puis réessai **sans doublon** ; fichier corrompu jamais « transferred » ; source absente ; Drive presque plein / plein ; configuration absente ; ≤ 50 sous-requêtes ; endpoint désactivé, 401 sans identifiants/secret erroné/JWT non admin, aucun secret dans les réponses. Deux gardes (vérification, anti-doublon) ont été cassés volontairement : les tests échouent bien. |
| Aucune suppression | assertion dans les tests : aucun appel DELETE/remove/trash n'est jamais émis |

**NON TESTÉ** (nécessite vos accès) : vrai Google Drive (OAuth, quotas réels), Supabase hébergé, Cloudflare Pages déployé (`crypto.subtle.digest("MD5")` est une extension Workers, testée ici avec `node:crypto`), `pg_cron`, appareils mobiles. Sur mobile, rien n'a changé côté invités. Tests 1, 3 (compression/orientation) et 5 de votre liste : non concernés par la phase 1, le pipeline d'envoi n'est pas modifié ; la publication après modération reste couverte par les tests existants.
