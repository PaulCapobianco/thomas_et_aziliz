# Sauvegarde des photos sur Google Drive — phase 1

**État : code et tests locaux prêts. Rien n'est déployé, aucune migration appliquée en production, aucun secret créé.**
Compression inchangée (JPEG 3000 px, q0,90, ≈ 600 Ko). WebP et autres optimisations : reportés après le mariage (29 octobre 2026).

> Les documents plus anciens du dossier disent encore « 31 octobre » : la date retenue est le **29**.

## 1. Fonctionnement

```
Invité ──► Supabase Storage + register_photo      (inchangé : c'est ce qui confirme l'envoi à l'invité)
                    │
  pg_cron (1/min) ──► Cloudflare Pages Function  POST /api/drive-sync     ◄── bouton admin (secours)
                    │   0. file vide ? -> on s'arrête, Google n'est pas contacté
                    │   1. jeton Google renouvelé   2. espace Drive vérifié (≥ 500 Mo libres)
                    │   3. 6 photos réservées (drive_claim, FOR UPDATE SKIP LOCKED : jamais deux fois la même)
                    │   4. téléchargement Supabase -> recherche d'un fichier déjà créé -> envoi Drive
                    └─► 5. taille ET MD5 comparés à ce que Drive annonce -> drive_mark_transferred
                           (sinon drive_mark_failed + erreur conservée)
```

- Statuts `photos.drive_sync_status` : `pending` → `processing` → `transferred` / `failed`.
- **Rien n'est jamais supprimé**, ni sur Supabase ni sur Drive. Le code n'émet aucun DELETE, aucune mise à la corbeille, aucun partage (testé).
- La copie ne change pas le statut de modération : une photo en attente, masquée ou signalée reste telle quelle ; seul `drive_*` change.
- Anti-doublon : chaque fichier Drive porte `appProperties.photoId`. Après une réponse perdue ou un crash, le réessai retrouve le fichier existant au lieu d'en recréer un.
- Reprises : `failed` repris automatiquement jusqu'à 6 fois (délai 2, 4, 6… minutes) ; `processing` abandonné depuis > 10 min repris ; le bouton admin remet les échecs à zéro.
- Erreur « globale » (jeton révoqué, Drive plein, quota par minute) : le lot est remis en file **sans consommer d'essai** ; erreur propre à une photo (source absente, fichier corrompu) : cette photo passe en `failed`.
- Interrupteur : sans `DRIVE_SYNC_ENABLED` **exactement égal à `true`**, l'endpoint répond 503 et ne contacte ni Google ni Supabase.

À noter : une photo supprimée par l'admin n'est plus copiée, mais **une copie déjà faite reste sur Drive** (à supprimer à la main si nécessaire, par exemple pour une photo signalée comme gênante). Les photos masquées ou en attente de validation sont copiées dans « Photos publiques » du Drive, qui reste privé.

## 2. Déclenchement automatique (point critique)

Les Pages Functions n'ont **pas** de déclencheur planifié et le parcours invité ne doit pas être modifié. La solution gratuite retenue est **`pg_cron` + `pg_net` dans Supabase**, qui appelle l'endpoint toutes les minutes avec un secret partagé. Sans cela, **rien ne copie les photos tant que quelqu'un n'appuie pas sur le bouton de l'admin**.

Garde-fous :
- Une exécution à vide coûte un seul appel Supabase (la file est lue d'abord) : 1 440 appels/jour, très loin des 100 000 requêtes/jour du plan gratuit Workers.
- Si le cron s'arrête (extension désactivée, secret changé, Cloudflare en panne), l'admin affiche « des photos attendent depuis plus de 15 minutes, lancez la sauvegarde manuellement ».
- Deux exécutions qui se chevauchent sont sans danger (réservation exclusive, testée avec deux sessions PostgreSQL simultanées).
- Autorité de l'appel : en-tête `x-sync-secret` (≥ 32 caractères, comparaison à temps constant) **ou** jeton de session d'un administrateur Supabase. Tout autre appel : 401.

Mise en place (étape D-3 plus bas) et supervision :
```sql
select * from cron.job_run_details order by start_time desc limit 5;        -- le cron tourne-t-il ?
select status_code, left(content::text, 200), created from net._http_response order by created desc limit 5;  -- réponses de Cloudflare
```

## 3. Qui fait quoi

| Action | Vous (compte, mot de passe, argent, clic de consentement) | Je peux l'automatiser (scripts du dépôt) |
|---|---|---|
| Projet Google Cloud, API Drive, écran de consentement, **publication en production**, identifiants OAuth | ✔ (navigateur, 15 min) | — |
| Clic de consentement Google (une fois) | ✔ | `scripts/drive-auth.mjs` affiche l'URL et récupère le jeton |
| Création des dossiers Drive | | `scripts/drive-setup.mjs` (refuse d'en créer un second jeu) |
| Secrets Cloudflare | ✔ (vous saisissez les valeurs) | commandes `wrangler pages secret put` fournies |
| Migration SQL, extensions `pg_cron`/`pg_net`, planification | ✔ (SQL Editor Supabase) | SQL fourni, prêt à coller |
| Déploiement | ✔ ou sur votre ordre | `npm run deploy` |

Je n'ai accès à aucun de vos comptes : **tout ce qui touche Google, Cloudflare et Supabase hébergés reste à exécuter par vous**, et je ne prétends rien avoir testé sur ces services réels.

## 4. Configuration pas à pas

### Google Cloud (navigateur)
1. https://console.cloud.google.com → sélecteur de projet en haut → **Nouveau projet** → nom « mariage-photos » → Créer, puis le sélectionner. Pas d'organisation nécessaire avec un compte Gmail.
2. Menu **API et services > Bibliothèque** → chercher « Google Drive API » → **Activer**.
3. Menu **Google Auth platform** (ou « API et services > Écran de consentement OAuth ») → **Commencer** : nom de l'application « Mariage photos », e-mail d'assistance = le vôtre ; **Audience : Externe** ; e-mail de contact = le vôtre ; accepter la politique ; Créer.
4. **Accès aux données (Data access) > Ajouter ou supprimer des champs d'application** : cocher **uniquement** `https://www.googleapis.com/auth/drive.file` (« voir, modifier, créer et supprimer uniquement les fichiers Google Drive que vous utilisez avec cette application »). Aucun autre. Enregistrer.
   - `drive.file` est classé **non sensible** par Google ([doc](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)) : pas de procédure de validation lourde. L'application ne voit **que** les fichiers qu'elle crée elle-même : elle ne peut lire ni modifier le reste de votre Drive (d'où l'obligation de créer les dossiers avec `drive-setup`, pas à la main).
5. **Audience > Publier l'application** → confirmer le passage **« En production »**. **À faire AVANT l'étape 7.** En mode « Test », Google fait expirer le jeton après **7 jours** ([doc](https://developers.google.com/health/setup)) : la sauvegarde s'arrêterait en pleine semaine du mariage. En production, le jeton ne s'invalide que s'il est révoqué, inutilisé ~6 mois ou si vous changez les droits du compte.
   - Le plafond de 100 utilisateurs de Google concerne les portées sensibles/restreintes ([doc](https://support.google.com/cloud/answer/15549945)) ; vous êtes l'unique utilisateur.
   - Un écran « Google n'a pas validé cette application » peut apparaître à la connexion : il est normal pour un usage personnel (*Avancé > Accéder à … (non sécurisé)*). Je n'ai pas pu vérifier ici si Google l'affiche pour une portée non sensible ; dans les deux cas la procédure est la même.
6. **Clients (Identifiants) > Créer un client > Type : Application de bureau** → nom « sync » → Créer. Notez **ID client** et **Code secret** dans votre gestionnaire de mots de passe. Ne téléchargez pas le JSON dans le dossier du projet.

### Jeton et dossiers (terminal, sur votre machine)
Saisie sans écho et hors historique du shell :
```bash
cd KIT_CODEX_MARIAGE_V3
export GOOGLE_CLIENT_ID='xxxx.apps.googleusercontent.com'
read -rs -p "Code secret client : " GOOGLE_CLIENT_SECRET; export GOOGLE_CLIENT_SECRET; echo
```
7. `node scripts/drive-auth.mjs` → ouvrir l'adresse affichée, choisir **le compte Google qui possède le Drive de sauvegarde**, accepter. Le terminal affiche `GOOGLE_REFRESH_TOKEN`. Il n'est écrit nulle part ailleurs. Copiez-le dans votre gestionnaire de mots de passe, puis :
   ```bash
   read -rs -p "Refresh token : " GOOGLE_REFRESH_TOKEN; export GOOGLE_REFRESH_TOKEN; echo
   ```
8. `node scripts/drive-setup.mjs` (**une seule fois**) crée « Mariage Thomas & Aziliz » avec « Photos publiques » et « Photos privées - Mariés uniquement ». Il refuse de s'exécuter si le dossier existe déjà.
9. Il affiche `DRIVE_FOLDER_PUBLIC=…` et `DRIVE_FOLDER_PRIVATE=…` : à noter. Vérifier dans https://drive.google.com : dossiers présents, **icône de partage absente**, « Accès : seulement vous ».
   Fermez ensuite le terminal ou faites `unset GOOGLE_CLIENT_SECRET GOOGLE_REFRESH_TOKEN`.

### Cloudflare (secrets de production)
10. Pour chaque ligne, la commande demande la valeur (non affichée) :
```bash
npx wrangler login        # une fois
for n in DRIVE_SYNC_ENABLED SUPABASE_URL SUPABASE_PUBLISHABLE_KEY SUPABASE_SERVICE_ROLE_KEY \
         GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REFRESH_TOKEN \
         DRIVE_FOLDER_PUBLIC DRIVE_FOLDER_PRIVATE SYNC_SECRET; do
  npx wrangler pages secret put "$n" --project-name thomas-aziliz-mariage
done
```
| Nom | Valeur |
|---|---|
| `DRIVE_SYNC_ENABLED` | **`false`** au début. `true` uniquement à l'étape D-4 |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | ceux de `config.js` (publics) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase > Project Settings > API > clé `service_role` / secret. **Uniquement ici.** Elle contourne la sécurité des lignes : elle ne sert qu'à appeler les fonctions `drive_*` et lire les fichiers à copier |
| `GOOGLE_*`, `DRIVE_FOLDER_*` | étapes 6 à 9 |
| `SYNC_SECRET` | `openssl rand -hex 32` (64 caractères ; **minimum 32**, sinon l'authentification par secret est refusée) |
| `DRIVE_BATCH` | optionnel, 1 à 8 (défaut 6) |

Un secret Pages n'est pris en compte qu'après un **nouveau déploiement** (point à confirmer lors de l'étape D). `wrangler pages secret put` ne cible que l'environnement de production.

### Supabase
11. Étape D-1 (migration) et D-3 (planification), voir §5. Les réglages Supabase à vérifier : *Database > Extensions* : activer `pg_cron` et `pg_net`.

### Premier transfert de test et vérification
12. Déclenchement manuel : admin du site > bouton « Lancer la sauvegarde Drive maintenant » (ou `curl -X POST -H "x-sync-secret: …" https://thomas-aziliz-mariage.pages.dev/api/drive-sync`). Réponse attendue : `{"ok":true,"claimed":N,"transferred":N,"failed":0,…}`.
13. Dans Drive : ouvrir « Photos publiques » / « Photos privées… » : un fichier `AAAAMMJJ-HHMMSS_<uuid>.jpg` par photo, ouvrable, taille ≈ celle de Supabase, **non partagé**. Dans l'admin : « N copiée(s), 0 en échec ». Une photo « Mariés » doit être **uniquement** dans le dossier privé.

## 5. Déploiement progressif (rien n'est lancé sans votre accord)

**Étape A — Sauvegarde** ✔ en grande partie faite
- Code commité sur la branche `feat/drive-sync-phase1` (non fusionnée, non poussée).
- Avant la migration : *Supabase > Database > Backups* (ou `pg_dump` si disponible) et export des photos (page admin « Exporter les photos »).
- Retour arrière relu : §6.

**Étape B — Tests réels isolés** (aucun impact sur la production)
- Créer un second projet Supabase gratuit « mariage-test » ; y appliquer 0001 → 0005 ; créer un admin de test.
- Dossiers Drive de test : `DRIVE_ROOT_NAME="TEST - Mariage" node scripts/drive-setup.mjs`.
- Lancer la fonction **en local** avec les vraies API (aucun déploiement) : créer `.dev.vars` (ignoré par Git) avec les variables du §4 pointant sur le projet de test, `DRIVE_SYNC_ENABLED=true`, puis `npx wrangler pages dev dist --port 8788`.
- Envoyer 2 photos depuis le site de test (une publique, une « mariés »), appeler `POST http://localhost:8788/api/drive-sync`, vérifier le §4-13. Tester ensuite : révoquer l'accès (https://myaccount.google.com/permissions) puis relancer → `drive_auth`, photos intactes et remises en file ; remettre l'accès.

**Étape C — Préparation de production**
- Migration `0005` : additive (colonnes avec valeur par défaut, fonctions nouvelles ; aucune table ni policy existante modifiée, rejouable). Vérifié en local : T40 (données existantes conservées).
- Secrets posés avec `DRIVE_SYNC_ENABLED=false`. Vérifié en local, y compris dans le vrai runtime Cloudflare (workerd) : 503 `disabled`, aucun appel.

**Étape D — Mise en service (sur votre ordre)**
1. Appliquer `0005` dans le SQL Editor de la production. Les photos existantes passent en `pending` (elles seront copiées, jamais modifiées).
2. `npm run deploy` (publie aussi `functions/`). Vérifier tout de suite : un invité peut envoyer une photo, la galerie s'affiche, l'admin s'ouvre (une ligne Drive peut apparaître).
3. Planification (après activation de `pg_cron`/`pg_net`). Version simple ; remplacer `SYNC_SECRET` :
   ```sql
   select cron.schedule('drive-sync', '* * * * *', $$
     select net.http_post(
       url := 'https://thomas-aziliz-mariage.pages.dev/api/drive-sync',
       headers := '{"content-type":"application/json","x-sync-secret":"SYNC_SECRET"}'::jsonb,
       body := '{}'::jsonb, timeout_milliseconds := 30000) $$);
   ```
   (Le secret est alors lisible par les administrateurs de la base dans `cron.job`. Variante Supabase Vault : `select vault.create_secret('SYNC_SECRET', 'drive_sync_secret');` puis `(select decrypted_secret from vault.decrypted_secrets where name = 'drive_sync_secret')` à la place de la valeur dans `jsonb_build_object('x-sync-secret', …)` ; syntaxe à valider dans le SQL Editor.)
4. Activer progressivement : passer `DRIVE_SYNC_ENABLED` à `true` + redéploiement ; **d'abord un déclenchement manuel** depuis l'admin, vérifier les premières copies dans Drive (§4-13) ; seulement ensuite laisser le cron tourner.
5. Surveillance : admin (compteurs, alerte > 15 min), requêtes de supervision du §2, Cloudflare > Pages > Functions > logs en temps réel (les fonctions n'écrivent aucun log : seuls les codes de réponse apparaissent).

## 6. Retour arrière (du plus léger au plus complet)
1. Immédiat : `npx wrangler pages secret put DRIVE_SYNC_ENABLED --project-name thomas-aziliz-mariage` → `false`, puis redéploiement ; ou arrêt du cron seul : `select cron.unschedule('drive-sync');`.
2. Code : le commit de la phase 1 n'est que sur la branche `feat/drive-sync-phase1` ; la production reste sur `release-mariage` tant que vous ne déployez pas.
3. Base : `supabase/optional/rollback_0005_drive_sync.sql` supprime colonnes et fonctions Drive sans toucher aux photos, fichiers, policies ni à la modération. Les fichiers déjà sur Drive restent.
4. Sans aucune de ces pièces, le site fonctionne à l'identique ; l'admin masque seul la ligne Drive si la migration est absente.

## 7. Audit de sécurité (constats vérifiés dans le code et en local)
- **Dossiers privés** : le code ne crée que des dossiers (aucune API `permissions`), n'émet aucun partage ni lien public ; les tests échouent si un appel `permissions` apparaît. Un Drive personnel crée tout en privé par défaut.
- **Photos « Mariés »** : uniquement dans le dossier privé, jamais dans la galerie publique (aucune modification de `gallery_page`, RLS ou Storage ; tests de modération inchangés au vert).
- **Secrets** : lus uniquement par la fonction Cloudflare (`env.*`), jamais dans `dist/`, `config.js`, les réponses (test), ni les logs (aucun `console.*` dans le code serveur, test automatique). `.dev.vars` et `.env*` sont ignorés par Git ; le script de déploiement bloque déjà tout JWT `service_role` dans `dist/`.
- **Endpoint** : POST uniquement, 503 si désactivé, 401 sans secret valide (≥ 32 car.) ni session administrateur Supabase vérifiée via `is_admin()` ; id de photo validé (UUID) ; erreurs génériques, sans détail.
- **Base** : fonctions `drive_*` accordées à `service_role` seul (anon, utilisateur non admin et même admin connecté refusés, testé) ; colonnes Drive illisibles pour les invités ; `admin_drive_*` vérifient `is_admin()`.
- **Portée OAuth** : `drive.file` seulement (le strict minimum : Google la recommande pour ce cas).
- **Compte de service écarté** : il n'a pas de quota sur un Drive personnel (`storageQuotaExceeded`) ; OAuth avec votre compte est la voie compatible avec un Drive gratuit.

## 8. Résultats des tests (au 23 octobre 2026)
| Suite | Résultat |
|---|---|
| `npm run test:sql` (PostgreSQL 16 jetable + stub Supabase) | **tous PASS** : tests existants inchangés, T40 (0005 sur données existantes), T41-T50 (file, statuts, reprises, droits, colonnes cachées, relance), T47b-c (taille de file), T51 (deux sessions simultanées : 10 photos réservées une seule fois) |
| `npm run test:drive` (Google/Supabase simulés) | **25/25 PASS** : publique/privée, transfert vérifié, jeton expiré/révoqué, Drive saturé (avant et pendant), Drive 503, réponse perdue puis reprise sans doublon, Supabase en panne (réservation, téléchargement, après envoi), fichier corrompu, source absente, photos existantes par lots de 6, double déclenchement, file vide sans appel Google, ≤ 50 sous-requêtes, `DRIVE_SYNC_ENABLED` ≠ `true` (6 variantes), accès non autorisé, secret trop court, aucune réponse ne contient de secret, aucun `console.*`, aucun DELETE/permissions |
| Runtime Cloudflare réel (workerd via `wrangler pages dev`, services Google/Supabase simulés par un serveur local) | compilation OK ; `crypto.subtle.digest("MD5")` correct ; flux complet OK (2 photos, dossiers public/privé, 200 Ko) ; file vide `idle` ; 405/401/503 corrects ; `DRIVE_SYNC_ENABLED=false` → 503 |
| Playwright (modération, export ZIP, signalements, parcours, lightbox, partage, barre d'envoi, messages) | **397 réussis, 2 ignorés par la suite, 0 échec** (3 navigateurs/formats : chromium, mobile, webkit) |
| Scripts `drive-setup` / `drive-auth` | syntaxe vérifiée ; `drive-setup` testé avec de faux services : crée les 3 dossiers, refuse un second passage (un bug de syntaxe a été trouvé et corrigé). `drive-auth` (consentement Google réel) : non testé |
| Garde-fous vérifiés par mutation | retirer la vérification MD5 ou l'anti-doublon fait échouer les tests |

**NON TESTÉ — nécessite vos accès** : Google Drive réel (OAuth, quotas réels, écran de consentement, durée de vie du jeton), Supabase hébergé (`pg_cron`, `pg_net`, Vault, clé `service_role`), Cloudflare déployé (secrets en production), appareils mobiles. Les simulations ne prouvent pas que ces services fonctionnent ensemble : c'est l'objet de l'étape B puis du premier déclenchement manuel de l'étape D.

## 9. Risques résiduels et solutions de secours
| Risque | Probabilité / effet | Secours |
|---|---|---|
| Application OAuth laissée en « Test » | jeton expiré après 7 jours, copie arrêtée (photos toujours sur Supabase) | publier en production (étape 5), puis régénérer le jeton |
| `pg_cron` indisponible ou mal configuré | photos non copiées en continu | bouton admin ; alerte > 15 min ; à défaut un appel `curl` manuel |
| Drive presque plein (< 500 Mo libres) | lots refusés, rien perdu | libérer de l'espace ; les photos restent sur Supabase |
| Clé `service_role` dans Cloudflare | forte puissance si Cloudflare est compromis | secret chiffré, accès Cloudflare protégé (2FA) ; la clé peut être régénérée dans Supabase |
| Dépendance au quota Supabase | les photos restent sur Supabase pendant cette phase (aucune suppression) | surveiller `Stockage` dans l'admin |
| Écran de consentement/validation Google inattendu | blocage de l'étape 7 | consulter l'écran « Audience » ; en dernier recours, désactiver la sauvegarde : le mariage ne dépend pas d'elle |
| Photos supprimées ensuite par l'admin | la copie Drive subsiste | suppression manuelle dans Drive |
