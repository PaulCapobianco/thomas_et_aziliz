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

## 10. Tests réels du 24 octobre 2026 : ce qui est prouvé, ce qui ne l'est pas

### Prouvé sur de VRAIS composants (en local, sans compte ni coût)
| Quoi | Résultat |
|---|---|
| `scripts/drive-integration-test.mjs` : **vrai** Supabase Storage API (image officielle v1.14.6) + **vrai** PostgREST + PostgreSQL 16, migrations 0001 → 0005 ; Google simulé | **27/27 PASS** : file vide sans appel Google ; dépôt d'invité comme le site (clé anon, Storage, `register_photo`) ; A publique visible en galerie, B « mariés » jamais ; lien de signature refusé à un invité pour B ; `DRIVE_SYNC_ENABLED=false` → 503 sans effet ; 401 sans identifiants / mauvais secret / utilisateur non admin (JWT réel) / clé anon ; **copie déclenchée par un vrai JWT administrateur** (`is_admin()` via PostgREST) ; statuts `transferred` + `drive_file_id` + taille ; modération inchangée ; A dans le dossier public, B **uniquement** dans le privé, taille et MD5 exacts, aucun partage ; fichiers sources conservés ; 2e exécution = file vide ; relance sans doublon ; jeton invalide → `drive_auth`, photo restée en file ; **Storage gelé** (`docker pause`) → `failed/source_unreachable` après le délai, puis reprise sans doublon ; compteurs admin et refus aux non-admin |
| `scripts/real-http-test.mjs` (test de sécurité HTTP existant du dépôt) avec 0005 appliquée | **ALL PASS** : rien de l'existant n'est altéré |
| Runtime Cloudflare réel (workerd, `wrangler pages dev`) + vraie pile Supabase, Google simulé | 401 utilisateur ordinaire, copie des 2 photos avec le vrai JWT admin, 2e appel `idle` (inclut `AbortSignal.timeout` et MD5 dans workerd) |
| **`pg_cron` 1.6.4 + `pg_net` 0.20.4 + Vault 0.3.1** (image officielle `supabase/postgres:15.19.0.007`) | Les **deux** variantes du §5 (secret dans l'en-tête, et secret dans Vault) se déclenchent à la minute pile ; le récepteur reçoit le POST, l'en-tête `x-sync-secret` (64 car.), `content-type` et le corps ; `cron.job_run_details` = `succeeded` ; `net._http_response` = 200. La syntaxe Vault est validée |
| Playwright, branche `feat/drive-sync-live-tests` | **454 réussis, 0 échec**, 59 ignorés (pile réelle / projet hébergé, désactivés par défaut) ; dont 18 tests de la ligne Drive de l'admin |
| `npm run test:drive`, `npm run test:sql` | 27/27 ; tous PASS (dont 2 sessions PostgreSQL simultanées) |
| `wrangler pages functions build` | seule la route `/api/drive-sync` est envoyée au Worker : le trafic statique du site reste gratuit et illimité |

### NON prouvé (nécessite vos accès, rien n'est affirmé à leur sujet)
- **L'API Google Drive réelle** : aucun secret n'existe dans la session de l'assistant. Commandes ci-dessous, à lancer dans **votre** terminal.
- **Un projet Supabase hébergé de test** : aucun n'existe. L'équivalent local (mêmes composants officiels) a été utilisé.
- **`pg_cron` / `pg_net` sur le plan gratuit hébergé** : la documentation officielle consultée ne fixe aucune restriction (recommandation : 8 tâches simultanées au plus, nous en utilisons une) mais ne le garantit pas non plus. À vérifier : Supabase > Database > Extensions, `pg_cron` et `pg_net` doivent pouvoir s'activer. Un projet gratuit est mis en pause après 7 jours d'inactivité (source tierce, à confirmer sur la page de tarification) : les tâches planifiées s'arrêtent alors.
- L'appel réel de `pg_net` vers `thomas-aziliz-mariage.pages.dev` (réseau Internet), et les téléphones.

### Défauts trouvés par ces tests et corrigés (avec tests de non-régression)
1. **Aucun délai sur les appels réseau** : un Supabase qui accepte la connexion sans répondre bloquait le lot. Délai de 20 s ; la photo passe en `failed` (`source_unreachable`) et est reprise. Tests 17 / 17b.
2. **Message du bouton « Relancer » écrasé** par le rafraîchissement des compteurs : aucun retour visible si Drive était indisponible. Ligne dédiée. 2 tests.

### Commandes à lancer dans VOTRE terminal (les secrets ne passent jamais par la conversation)
```bash
cd /home/paul/www/formation.studi/QR_CODE/worktree-drive-live    # branche feat/drive-sync-live-tests
export GOOGLE_CLIENT_ID='xxxx.apps.googleusercontent.com'
read -rs -p "Code secret client : " GOOGLE_CLIENT_SECRET; export GOOGLE_CLIENT_SECRET; echo
read -rs -p "Refresh token : "      GOOGLE_REFRESH_TOKEN; export GOOGLE_REFRESH_TOKEN; echo
```
**A. Contrôle de confidentialité des dossiers de production (lecture seule, ne modifie rien)**
```bash
export DRIVE_FOLDER_PUBLIC='<identifiant du dossier « Photos publiques »>'
export DRIVE_FOLDER_PRIVATE='<identifiant du dossier « Photos privées »>'
node scripts/drive-verify-folders.mjs        # attendu : « tout est PASS » (non partagé, propriétaire seul)
```
**B. Test réel complet : vraie API Google Drive + pile Supabase locale jetable** (requiert un dossier privé existant « TEST - Mariage (sync) » ou « TEST - Mariage » avec ses sous-dossiers « Photos publiques » et « Photos privées - Mariés uniquement » ; ne crée aucun dossier ; envoie 2 JPEG synthétiques, non personnels ; ne supprime **rien** ; n'utilise **jamais** les dossiers de production). Si votre dossier de test existant porte un autre nom, définissez `DRIVE_TEST_ROOT_NAME` avec un nom commençant par `TEST - `.
```bash
bash scripts/real-stack.sh up                 # ~15 s
node scripts/real-stack-proxy.mjs &           # passerelle locale :5057
node scripts/drive-integration-test.mjs --google=live --with-docker-outage
kill %1; bash scripts/real-stack.sh down      # nettoyage de la pile jetable
```
Attendu : `RÉSULTAT : 27/27 PASS — Google RÉEL`. Le test affiche seulement des identifiants de fichiers (non secrets). Copiez-collez la sortie : elle ne contient aucun secret. Ensuite, supprimez à la main le dossier de test dans Drive si vous le souhaitez.

**C. (Optionnel) Fonction Cloudflare en local avec `.dev.vars`** (projet Supabase de TEST uniquement ; le script refuse l'URL de production)
```bash
# exporter aussi SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / SUPABASE_SERVICE_ROLE_KEY du projet de TEST, DRIVE_FOLDER_* de TEST
bash scripts/make-dev-vars.sh                 # écrit .dev.vars (mode 600, ignoré par Git, aucune valeur affichée)
npm run build && npx wrangler pages dev dist --port 8788
```
**Créer un projet Supabase de test (gratuit)** : supabase.com > New project « mariage-test » > SQL Editor : coller `0001` → `0005` dans l'ordre > Authentication > Users : un admin de test > `insert into public.admin_users …` > Project Settings > API : URL, clé publique, clé `service_role` **de ce projet de test seulement**. Ne jamais mettre la `service_role` de production dans `.dev.vars`.

## 11. Procédure de mise en production (rien n'est lancé sans votre accord)

### Où en est chaque lignée de code
Un déploiement Cloudflare Pages **remplace tout le site**. Le piège connu : déployer une branche sans les pages légales les supprimerait de la production (liens donnés à Google).

| Branche | Contenu | À déployer ? |
|---|---|---|
| `deploy/legal-sur-production` | production actuelle (déploiement `00e0920a`) : site d'origine + pages légales | état actuel |
| **`deploy/legal-drive`** | production actuelle **+ Drive uniquement** (sans Export, sans refonte). Admin : +47 lignes additives. Garde-fou `deploy.sh` : refuse tout déploiement sans pages légales ni adresse de contact | **candidate** |
| `feat/drive-sync-live-tests` | Drive + tests réels, sur la lignée `release-mariage` (donc avec l'onglet Export) | non : pas la base de production |
| `refonte-legal` | refonte graphique + pages légales (sans Drive) | après le Drive |
| `refonte-graphique`, `feat/page-confidentialite` | sans pages légales / avec Export | non pour la production |

### Étapes
**Étape 0 : tests Google réels (vous, ~10 min).** Commandes A et B du §10. Ne passez pas à la suite si B n'est pas `27/27 PASS`.

**Étape 1 : préparer, sans rien activer.**
1. Sauvegarde : Supabase > Database > Backups (ou `pg_dump`) + export des photos (page admin « Exporter les photos » si disponible).
2. Secrets Cloudflare (§4), avec **`DRIVE_SYNC_ENABLED=false`**.
3. Migration `0005_drive_sync.sql` dans le SQL Editor de la production (additive, rejouable). Contrôle : `select count(*) from information_schema.columns where table_name='photos' and column_name like 'drive_%';` doit donner **7**.

**Étape 2 : déployer `deploy/legal-drive`** (`npm run deploy` depuis ce dossier ; le script s'arrête si les pages légales manquent). Contrôles immédiats : `/`, `/confidentialite`, `/conditions-utilisation` en 200 ; `POST /api/drive-sync` → `503 {"error":"disabled"}` ; l'admin affiche la ligne « Sauvegarde Google Drive » ; un invité peut envoyer une photo ; la galerie s'affiche.

**Étape 3 : activer, progressivement.**
1. `DRIVE_SYNC_ENABLED=true` (un secret Pages ne s'applique qu'à un nouveau déploiement : redéployer).
2. Premier essai sur **une seule photo** : `curl -X POST -H "x-sync-secret: …" -d '{"id":"<uuid d'une photo>"}' https://thomas-aziliz-mariage.pages.dev/api/drive-sync`, puis contrôle dans Drive (dossier, taille, non partagé).
3. Bouton admin « Lancer la sauvegarde Drive maintenant » : copie progressive de l'existant (6 photos par appel).

**Étape 4 : planification** (SQL du §5, étape D-3, avec Vault de préférence). Vérifier ensuite `cron.job_run_details` et `net._http_response`.

**Étape 5 : surveillance** pendant l'événement : ligne Drive de l'admin (alerte si une photo attend plus de 15 min), bouton de secours, `select * from cron.job_run_details order by start_time desc limit 5;`.

**Étape 6 (après le Drive, si vous le voulez) : la refonte graphique** sur la même base, avec la procédure utilisée pour `refonte-legal` (commits de design appliqués un à un), puis nouveau cycle de tests et de déploiement gardé.

### Calendrier conseillé avant le 31 octobre
Tests réels : aujourd'hui ou demain · migration + déploiement `deploy/legal-drive` : **au plus tard le 27** · cron et premiers contrôles : le 27-28 · **aucune modification du code ni du déploiement à partir du 29**. Si un point bloque, la sauvegarde Drive reste facultative : le site fonctionne à l'identique sans elle.

### Retour arrière
| Besoin | Action |
|---|---|
| Couper Drive immédiatement | `select cron.unschedule('drive-sync');` et `DRIVE_SYNC_ENABLED=false` (+ redéploiement) |
| Revenir au site d'avant Drive | Cloudflare > Pages > Déploiements > `00e0920a-fc4a-4778-aa43-694e73b9be35` > « Rollback to this deployment » (pages légales conservées) |
| Retirer la base Drive | `supabase/optional/rollback_0005_drive_sync.sql` (ne touche ni photos, ni fichiers, ni modération) |
