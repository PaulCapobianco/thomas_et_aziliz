# Audit indépendant — 11 octobre 2026 (branche feat/mariage-photos-mvp)

Périmètre : lecture complète des migrations, tests SQL, 4 modules JS, HTML, `_headers`, scripts ; exécution de tous les tests
disponibles ; ajout d'une pile **réelle** locale (Storage API officiel + PostgREST + PostgreSQL). Aucune modification distante,
aucune dépense, aucune clé privée.

## Conclusions

Aucun défaut critique de sécurité n'a été trouvé. L'inconnue n°1 du kit (dépôt anonyme Storage avec policy INSERT seule, « vérification A »)
est **levée sur le vrai moteur Storage** (v1.14.6) : le dépôt fonctionne sans policy SELECT et la lecture reste refusée. Elle reste à
confirmer une fois sur votre projet hébergé (`verify-storage.mjs`, 2 minutes).

| # | Point d'audit | Verdict | Preuve |
|---|---|---|---|
| 1 | Isolation public / privé / suspect | OK | SQL (T06, T07, T11d) + HTTP réel : signature refusée, `/object/authenticated` et `/object/public` refusés, `list()` ne révèle que le public publié |
| 2 | RLS et Storage | OK | SQL 117 assertions + HTTP réel, test de mutation (policy trop large ⇒ 5 FAIL) |
| 3 | Admin et sessions | OK | 6 RPC admin refusées à anon et à un compte connecté non admin ; client invité sans session persistante ; session admin en sessionStorage ; pas d'`innerHTML` |
| 4 | 2 signalements ⇒ masquée | OK | SQL T12 (80 sessions) + HTTP : 6 signalements simultanés ⇒ masquée ; même navigateur 2× ⇒ une seule voix |
| 5 | Contournements des RPC | OK avec limites | Écritures directes refusées, `register_photo` vérifie la présence, le MIME et la taille réels des deux objets, rejeu d'un id par un autre navigateur refusé (42501). **Limite** : voir risque R1 |
| 6 | Doublons exacts | OK | SQL T04/T23 ; HTTP : 12 envois simultanés du même fichier ⇒ 1 publié, 11 doublons |
| 7 | Envois simultanés | OK | idem + index unique partiel `ON CONFLICT` ; les orphelins d'un doublon tardif sont listés par `admin_orphans` |
| 8 | Compression / HEIC | Partiellement testé | JPEG/PNG/EXIF 6 testés sur 3 moteurs. HEIC et photos 12-48 Mpx : **non testés sur appareil** |
| 9 | Échec NSFWJS | OK, avec effet à connaître | Toute erreur, tout délai (15 s charge, 8 s inférence) ⇒ verdict `unavailable` ⇒ `pending_review/model_unavailable` : rien n'est publié par erreur, mais **la galerie reste vide pour cet invité tant que l'admin n'a pas libéré** (un clic : « Publier les photos sans premier filtrage ») |
| 10 | npm audit (4 modérées) | Sans impact en production | Une seule chaîne `sprintf-js → argparse → @tensorflow/tfjs-converter` (CLI de conversion de modèles, DoS par spécificateurs de format sur une entrée contrôlée par l'attaquant). `grep` : aucun `sprintf`/`argparse` dans `dist/` ni `vendor/`. Pas de correctif compatible : ne pas faire `npm audit fix --force` |

## Corrections effectuées (3 commits)

1. `fix: treat a Storage.remove that deleted fewer than 2 objects as a failed cleanup` — **seul bug de code trouvé.**
   `storage.remove()` répond 200 avec uniquement les objets réellement supprimés ; la RLS ou un chemin inexistant donne une
   liste vide **sans erreur**. L'admin voyait « supprimée » alors que les fichiers restaient (photo effacée en base, fichiers
   toujours stockés). Le mock renvoyait `[]` et masquait le problème ; il reproduit désormais la vraie réponse + test de régression.
2. `fix: let iOS convert HEIC to JPEG in the photo picker` — `accept` ne liste plus `image/heic|heif` : iOS livre alors un
   JPEG au lieu du HEIC brut (illisible sur les iOS anciens). Le décodeur accepte toujours un HEIC fourni. **À confirmer sur iPhone** (séance 4).
3. `test: add a real Storage API + PostgREST + PostgreSQL stack…` — `npm run test:real` (`scripts/real-stack.sh up|test|down`).

## Risques résiduels pour le 31 octobre

- **R1 — Faux signalements / saturation.** Les identifiants (`wk_uid`) sont fournis par le navigateur : une personne qui crée deux
  UUID peut masquer n'importe quelle photo publique (l'admin la restaure en un clic) et contourner les plafonds par navigateur
  (20 signalements / 10 min, 500 envois / 24 h) ; un abus de Storage jusqu'au quota est possible. Une déduplication par IP casserait
  le Wi-Fi partagé de la salle : non faite. Surveiller « Signalées » et le stockage (admin) pendant la soirée.
- **R2 — NSFWJS est falsifiable et non garanti.** Un client modifié peut envoyer `clean`. Premier appel de classification sur un vieux
  téléphone : un dépassement de 8 s désactive le filtre pour toute la session de cet invité (⇒ ses photos passent en attente).
  Le témoin doit savoir libérer (GUIDE_TEMOIN) ; vérifier le délai sur un vrai iPhone/Android bas de gamme.
- **R3 — URL signées valables 1 h** après un masquage (limite documentée, pas une révocation).
- **R4 — Projet hébergé en pause / quota** (offre gratuite) : décision d'offre à votre charge (GUIDE_PRODUCTION, séance 1).
- **R5 — Non testé** : téléphones réels, HEIC, réseau mobile, Auth hébergé (GoTrue), en-têtes de l'hébergeur final (la fusion de
  `Cache-Control` entre `/*` et `/*.html` dépend de la plateforme), rendu CSP sur le domaine final.
- **R6 — Photos d'essai à supprimer** avant le mariage, y compris les objets orphelins (fichiers sans ligne), via le Dashboard.
