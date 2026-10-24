# Préparation de la version combinée — 24 octobre 2026

**Cible :** `refonte-legal-drive` (refonte, pages légales, Drive). **Production actuelle :** Cloudflare Pages `thomas-aziliz-mariage`, branche `main`, déploiement `00e0920a-fc4a-4778-aa43-694e73b9be35` (`30e578f`). Aucun changement de production ne doit être lancé avant accord explicite.

## Préversion isolée

`npm run build:preview` génère `dist-preview/` (ignoré par Git) et vide uniquement dans cette copie l'URL et la clé publique Supabase. La préversion montre le design, les pages légales et l'écran d'administration, sans accès aux photos ni connexion administrateur réelle. La fonction Drive reçoit `DRIVE_SYNC_ENABLED=false` dans l'environnement Pages Preview et doit répondre `503 {"error":"disabled"}`. Le contrôle fonctionnel de l'admin et de la galerie se fait avec les tests Playwright locaux ; une recette distante avec données réelles demanderait un projet Supabase de test séparé.

Déploiement de préversion uniquement : `npx wrangler pages deploy dist-preview --project-name thomas-aziliz-mariage --branch review-refonte-legal-drive`. Ne jamais employer `--branch main` pour cette recette. Les URL Preview Pages sont publiques par défaut ; ne partager le lien qu'avec les personnes concernées ou activer l'accès Cloudflare avant diffusion. `_headers` impose déjà `X-Robots-Tag: noindex, nofollow`.

## Avant toute migration ou publication de production

1. Exécuter `supabase/optional/preflight_0005_drive_sync.sql` dans le SQL Editor **du bon projet**. Confirmer le nom et la version de la base, `photos` et `storage.objects`, les cinq colonnes métier nécessaires, `is_admin`, le bucket privé `photos`, et la disponibilité de `pg_cron`/`pg_net`. Si les sept colonnes `drive_*` ou les fonctions Drive existent déjà, arrêter et comparer le schéma avant de rejouer la migration.
2. Enregistrer les nombres agrégés de photos par audience. Vérifier dans **Database > Backups** si une sauvegarde récente et restaurable existe. Le plan gratuit ne garantit pas de sauvegarde quotidienne : si elle n'existe pas, lancer `bash scripts/backup-hosted-db.sh` après avoir pris host/port/utilisateur du **bon projet** dans le Dashboard. Le script demande le mot de passe sans écho, refuse un identifiant de projet différent, écrit une archive privée sous `.sensibles-local/preprod-backup/` (mode `700`, ignoré par Git), vérifie `pg_restore -l` et produit un SHA-256. Conserver une seconde copie hors de ce disque. Ne jamais utiliser `db reset --linked` ou `db push` pour cette opération.
3. Sauvegarder séparément les fichiers Storage : une sauvegarde de base ne contient que leurs métadonnées. Le script en lecture seule `scripts/export-photos.mjs` de `feat/drive-sync-live-tests` exporte full + miniatures des dossiers public et mariés, y compris les photos masquées/en attente, avec index et SHA-256. Il demande une connexion admin et n'utilise pas la clé `service_role`. Conserver l'export chiffré ou sur un support privé ; vérifier le code de sortie 0 et les deux comptes « N sur N ». Ne supprimer aucune photo source.
4. Garder une copie vérifiée de la migration `supabase/migrations/0005_drive_sync.sql` et de son résultat attendu. Elle ajoute sept colonnes, deux contraintes, un index et des fonctions ; elle ne programme aucun cron. Elle a passé les tests SQL locaux, dont conservation des données et concurrence. Sa compatibilité avec **ce** projet hébergé reste conditionnelle au résultat du préflight et à une sauvegarde vérifiée.

## Secrets Cloudflare préparés, non publiés

La production ne possède actuellement aucun secret Pages. Préparer dans un gestionnaire de mots de passe : `DRIVE_SYNC_ENABLED=false` au départ, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `DRIVE_FOLDER_PUBLIC`, `DRIVE_FOLDER_PRIVATE`, `SYNC_SECRET` (au moins 32 caractères aléatoires). Les dossiers Drive ont été vérifiés privés. Ne placer aucune valeur dans Git, `config.js`, un argument de commande ou ce document. La configuration des secrets de **production** attend l'accord explicite ; vérifier ensuite que le flag reste `false` au premier déploiement.

## Porte d'autorisation de production

Après sauvegardes et préflight validés, demander un accord distinct pour : (1) secrets de production désactivés et migration `0005`, (2) publication de `refonte-legal-drive`, (3) activation Drive et planification `pg_cron`/`pg_net`. Ne pas activer le cron tant que le premier transfert manuel n'est pas vérifié. Stocker `SYNC_SECRET` dans Vault plutôt qu'en clair dans `cron.job` si Vault est disponible. Le projet hébergé doit confirmer que les extensions sont disponibles ; les tests Docker ne prouvent pas leur état distant.

## Recette avant et après publication

Avant : tests `npm run check`, `npm test`, `npm run test:drive`, `npm run test:sql`, `npm run build`, audit npm ; préversion à 390 px, tablette et bureau ; accueil, galerie simulée, partage, visionneuse, admin simulé, confidentialité et conditions ; pas de débordement, erreurs JavaScript ou violation axe ; `/api/drive-sync` en 503. Comparer le commit candidat et le déploiement de production actuel.

Après accord et publication : vérifier les codes 200 de `/`, `/confidentialite`, `/conditions-utilisation`, `/admin`, les liens et les en-têtes noindex/CSP ; vérifier l'admin avec un compte autorisé et le refus d'un autre ; confirmer `DRIVE_SYNC_ENABLED=false` et `POST /api/drive-sync` en 503 ; vérifier la galerie et l'envoi public/privé avec de **nouvelles photos de test** seulement, après accord. Recompter les photos et confirmer qu'aucune photo existante n'a disparu. Tester iPhone Safari et Android Chrome avant diffusion du QR.

Après accord séparé d'activation Drive : un seul transfert manuel ciblé, contrôle dossier/MD5/statut/source conservée, puis cron à une minute ; consulter `cron.job_run_details`, `net._http_response` et les compteurs admin. Garder un bouton de déclenchement manuel si le cron est indisponible.

## Retour arrière sans suppression de données

1. Si Drive pose problème : désactiver le cron par `cron.unschedule('drive-sync')` **sur accord**, remettre `DRIVE_SYNC_ENABLED=false`, puis publier la configuration correspondante. Ne supprimer ni les fichiers Drive ni les originaux Supabase.
2. Si le site pose problème : dans Cloudflare Pages, revenir au déploiement de production `00e0920a-fc4a-4778-aa43-694e73b9be35` (version avec pages légales), après accord. Un rollback Pages ne restaure pas la base ni Storage.
3. Laisser par défaut les colonnes/fonctions additives de `0005` en place : l'ancien site les ignore. `supabase/optional/rollback_0005_drive_sync.sql` supprime les colonnes et donc les métadonnées Drive ; **ne pas l'exécuter** dans la procédure courante. Tout retour de base complet exige une sauvegarde et un accord distinct.
