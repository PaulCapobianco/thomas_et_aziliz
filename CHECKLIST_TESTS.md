# Recette — état réel au 11 octobre 2026

**PASS** = exécuté et réussi dans l'environnement indiqué. **FAIL** = exécuté avec anomalie restante. **NON TESTÉ** = preuve absente, jamais assimilée à PASS. Les mocks ne prouvent pas le Storage ni Auth Supabase réels.

## Commandes et preuves

| Commande / contrôle | Résultat | Preuve et portée |
|---|---|---|
| `npm run check` | PASS | Syntaxe des 4 modules applicatifs. Pas de commande lint/typecheck distincte ; JavaScript natif. |
| `npm run vendor` | PASS | SDK, bundle NSFW/TensorFlow, modèle et polices locaux. Assertion esbuild : argparse/sprintf-js absents du bundle. |
| `npm run build` | PASS | `dist/` généré par liste autorisée, sans tests, SQL, maquettes ou fixtures. Avertissement Supabase non configuré attendu. |
| `npm run test:sql` | PASS | PostgreSQL 16 jetable : 117 lignes d'assertions, plus T12 concurrence = 118 PASS, zéro FAIL. Deux assertions RETURNING* sont informatives : elles ne prouvent pas Storage HTTP. Migrations rejouées deux fois. |
| `npm test -- --reporter=line` | PASS | 60/60 cas au passage final complet, en 40,2 s : Chromium bureau, Chromium 360 px, WebKit iPhone émulé. Client Supabase simulé. Aucun test ignoré. |
| `npm test -- --grep 'polling\|lightbox\|modal\|real locally' --reporter=line` | PASS | 12/12 après la dernière correction du focus/rafraîchissement, en 7,9 s. Inclut les 3 nouveaux cas de polling (un par projet). Ces cas sont inclus dans la passe finale de 60 tests. |
| Modèle NSFW réel local | PASS | Chargement JSON + poids, inférence canvas et cinq classes sur Chromium et WebKit. Qualité de classification sur vraies photos : NON TESTÉ. |
| axe-core | PASS | Zéro violation détectée sur accueil, partage et administration dans les tests automatisés. N'est pas un audit lecteur d'écran complet. |
| `git diff --check` | PASS | Aucun défaut d'espaces Git. |
| `node --check scripts/verify-storage.mjs` + compilation Python | PASS | Syntaxe du script distant, serveur et estimateur. |
| `npm audit --omit=dev` / `npm audit` | FAIL documenté | Code retour 1 : 4 entrées modérées provenant d'une seule chaîne sprintf-js → argparse → TensorFlow → NSFWJS, aucune haute/critique. Pas de correctif compatible disponible. Modules concernés exclus du bundle navigateur, assertion vérifiée lors du vendor. |
| `bash scripts/real-stack.sh up` puis `npm run test:real` (audit Claude, 11 oct.) | PASS | Pile jetable **réelle** : PostgreSQL 16 + image officielle `supabase/storage-api` 1.14.6 + PostgREST 12.2.3, migrations 0001-0003 appliquées. `scripts/real-http-test.mjs` : 54 contrôles HTTP, tous PASS (dépôt anonyme sans compte, signature refusée sur privé/suspect/indisponible/masqué, lecture directe `/object/authenticated` et `/object/public` refusées, list() sans fuite, UPDATE/DELETE/INSERT directs refusés, 6 RPC admin refusées à anon et à un compte non admin, écrasement et suppression refusés, MIME/3 Mo/chemin refusés, 12 envois simultanés du même fichier = 1 publié + 11 doublons, 6 signalements simultanés = masquée, admin lit/publie/supprime). Test de mutation : une policy SELECT trop large fait échouer 5 contrôles. Limite : pas de GoTrue (JWT admin forgés), pas de Kong/CDN. |
| `tests/real-stack.spec.js` sur la pile réelle, Chromium + Pixel 7 + iPhone 13 (WebKit) | PASS ×3, répété | Envoi réel via supabase-js et le vrai modèle NSFWJS, doublon exact ignoré, envoi privé absent de la galerie d'un autre navigateur, miniatures et grande photo servies par URL signée, deux signalements de deux navigateurs masquent la photo. Navigateurs de bureau/émulés, pas des téléphones. |
| `npm test` après l'audit | PASS | 63 passés + 3 ignorés (le test de pile réelle sans `REAL_URL`). |
| `node scripts/verify-storage.mjs --test-project` | NON TESTÉ distant | Refus local attendu, code 2 : URL/clé absentes. Aucune requête distante effectuée. Procédure A–F prête dans README_DEPLOIEMENT. |
| Estimation `--assume-full-kb 350` et `--views 120` | PASS du calcul | Hypothèses, pas mesures sur vraies photos. 0,51–3,04 Go selon quantité ; 2,8 Go/24,6 Go de trafic selon scénario, avant marge. |

Les premières passes ont détecté puis corrigé : hiérarchie h1→h3 admin, landmark aside imbriqué, bouclage du focus et retour de focus après rafraîchissement. Les tests eux-mêmes ont été corrigés pour ignorer l'icône décorative dans le nom accessible et simuler correctement les événements tactiles. WebKit échouait initialement à cause des variables GTK/GIO Snap de l'environnement ; elles sont retirées uniquement du processus de test lorsqu'elles pointent vers Snap. Une dernière régression a été reproduite : un réessai conservait la destination publique malgré un nouveau choix privé. Le réessai prend désormais le choix affiché au clic ; les trois projets navigateur couvrent ce cas. Tous ces défauts sont résolus dans la passe finale de 60 tests PASS.

Référence de l'audit résiduel : [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). Ne pas rétrograder automatiquement TensorFlow/NSFWJS via `npm audit fix --force`.

## Matrice du cahier V2

| ID | Scénario | Local / émulation | Supabase ou appareils réels |
|---|---|---|---|
| T01 | Pas de couple.jpg, pas d'image cassée | PASS, fallback et screenshots | NON TESTÉ téléphone réel |
| T02 | QR ?k= puis Partager, clé conservée | PASS, avec localStorage et repli mémoire | NON TESTÉ QR imprimé |
| T03 | 3 JPEG + PNG, compression/full/thumb/finalisation | PASS, blobs réels et RPC mock ; SQL PASS | NON TESTÉ Storage HTTP |
| T04 | Doublons exacts par destination | PASS navigateur + SQL | NON TESTÉ distant |
| T05 | Rafales similaires conservées | PASS, deux fichiers différents | NON TESTÉ distant |
| T06 | Privés absents galerie et illisibles invité | PASS filtre UI mock + RLS SQL réelles sur stub | NON TESTÉ signatures distantes sur chemins connus |
| T07 | Suspect conservé en attente | PASS faux modèle + SQL | NON TESTÉ distant |
| T08 | Modèle absent → attente, privé envoyé | PASS faux modèle + SQL | NON TESTÉ appareil réel |
| T09 | Premier signalement visible | PASS UI mock + SQL | NON TESTÉ distant |
| T10 | Même navigateur une seule voix | PASS UI mock + SQL | NON TESTÉ distant |
| T11 | Deux identifiants distincts masquent | PASS UI mock + SQL | NON TESTÉ deux navigateurs sur serveur réel |
| T12 | Votes concurrents distincts / double clic | PASS 40 photos, 80 sessions SQL | NON TESTÉ Supabase réel |
| T13 | Auth et admin autorisé/non autorisé | PASS UI mock, droits SQL ; sessionStorage configuré | NON TESTÉ Auth distant/reconnexion réelle |
| T14 | Masquer/restaurer/pause/reprise | PASS UI mock + SQL persistée | NON TESTÉ distant |
| T15 | Restauration efface anciens votes | PASS SQL | NON TESTÉ distant |
| T16 | Upload partiel, trois essais, UUID neufs, annulation | PASS navigateur ; SQL refuse objet manquant | NON TESTÉ réseau mobile réel |
| T17 | Pagination 48→200, ajout pendant lecture, retrait hors page 1 | PASS navigateur ; SQL keyset/date identique PASS | NON TESTÉ charge distante |
| T18 | Lightbox, swipe, clavier, Escape, focus, téléchargement signé | PASS événements tactiles simulés, 3 projets | NON TESTÉ geste physique et téléchargement iOS réel |
| T19 | RPC/tables/Storage invité et compte non admin refusés | PASS SQL 117 assertions ; client invité sans session admin | PASS sur API Storage réelle **locale** (voir ligne real-stack) ; NON TESTÉ sur votre projet Supabase hébergé (verify-storage.mjs) |
| T20 | Réduction des animations | PASS media reduced-motion | NON TESTÉ préférences OS réelles |

## Responsive, accessibilité, SEO et performance

- **PASS** absence de débordement à 360 / 768 / 1440 px sur les trois écrans, avec captures dans `test-results/`. Captures mobile, tablette et bureau examinées visuellement ; CTA accueil visible, cartes/formulaires et boutons admin adaptés. Grille galerie testée sur 200 métadonnées synthétiques.
- **PASS** contrôles ≥44 px par CSS, labels et radios natifs, image alt, focus visible, modal native + Tab/Shift-Tab, Escape, restitution du focus après relecture. Axe vérifie notamment les contrastes des écrans testés. **NON TESTÉ** VoiceOver/TalkBack et toutes les combinaisons de zoom système.
- **PASS** titres/descriptions distincts, h1 unique visible, textes HTML, meta noindex/nofollow/no-referrer, robots, favicon et CSP/X-Robots-Tag réellement servis en local. **NON TESTÉ** en-têtes de l'hébergement final. Pas de sitemap/JSON-LD/OG photographique pour cet album non indexable.
- **PASS** miniatures 400 px, grands formats 1600 px, orientation EXIF 6 → portrait, JPEG/PNG/1px, fichier invalide isolé, URLs temporaires et canvas libérés, NSFW absent du chargement initial, polices/bibliothèques locales. Poids gzip mesurés : SDK ~55,7 Ko, JS app/partage/shared ~9,8 Ko avant petits correctifs finaux, CSS ~3,2 Ko ; NSFW/TensorFlow ~296 Ko différés + poids du modèle ~2,6 Mo non compressés. **NON TESTÉ** Lighthouse/CWV terrain, 48 Mpx sur téléphone, lot prolongé sur réseau faible.
- **PASS** validation MIME/taille avant traitement, texte de nom de fichier malveillant affiché comme texte, CSP sans unsafe-inline/unsafe-eval, aucun secret privilégié configuré. **NON TESTÉ** résistance à un abus distribué, hors garantie des garde-fous du kit.

## À remplir lors de la recette humaine

Date / URL / modèle iPhone + version Safari / modèle Android + version Chrome : **à compléter**.

- [ ] Vérification Storage A–E : ____ ; F privé, en attente, masqué : ____.
- [ ] Envois publics, privés, HEIC natif, doublons et photo verticale : ____.
- [ ] Deux navigateurs, deux signalements ; admin masque/restaure : ____.
- [ ] Pause/reprise, modèle désactivé ⇒ attente, libération après examen : ____.
- [ ] Wi-Fi faible/4G/coupure, retries, téléchargement réel et conservation des originaux : ____.
- [ ] Offre/quota, URL HTTPS/QR imprimé, témoin prêt : ____.

Ne cocher que ce qui a été réellement testé. Les étapes exactes sont dans README_DEPLOIEMENT, recette express.

## Projet Supabase hébergé — séance 2 (11 octobre 2026, après application des migrations)

Commande : `node scripts/hosted-check.mjs --hosted` (clé publishable de `.env.local`, non versionné). Projet `yxzxctaobzxmrcvxuifc`.
Le premier passage (migrations absentes) s'était arrêté sans écriture ; le second, ci-dessous, a été exécuté après leur application.

| Test | Projet hébergé | Détail |
|---|---|---|
| Rôle de la clé | PASS | `sb_publishable_…` (anon), vérifié avant tout appel |
| 7a Projet actif, non en pause | PASS | L'API répond |
| 7b Offre / quota | NON_TESTÉ | Non exposés par l'API publique |
| 1A Dépôt anonyme | PASS | Plan B inutile |
| 1B Signature d'un fichier non enregistré | PASS | `404 Object not found` |
| 1C list('public/thumbs') | PASS | 0 entrée visible |
| 1D check_duplicates([]) | PASS | `[]` |
| 1E admin_status | PASS | `42501 permission denied for function admin_status` |
| 2 Parcours (published, duplicate, gallery_page, URL signées HTTP 200 octets identiques, maries refusé et absent) | PASS ×9 | |
| 3 Suspecte (pending_review, absente, signature refusée) | PASS ×3 | |
| 4 Signalements (1 vote visible, already_reported, 2 votes masquent, privée / inexistante not_found) | PASS ×5 | |
| 5 Fuites directes (3 tables, 3 colonnes, INSERT/UPDATE/DELETE, 6 fonctions admin, écrasement, suppression) | PASS ×21 | |
| 6 Limites (3 Mo `413`, text/html et image/png `415`, 3 chemins `403`) | PASS ×6 | |
| **Total** | **48/48 PASS** | Non couvert : connexion admin (Auth), offre/quota, téléphones |

Objets déposés (à supprimer depuis l'admin) — bucket `photos` :
`public/thumbs/ded44a29-b9ee-41a4-aca9-a443c28d7114.jpg` (orphelin, test A) ;
photo publiée `ccd00903-8636-4898-ba60-cb088ee23028` (`public/thumbs|full/…`) — **visible dans la galerie publique** ;
doublon `577bc358-b339-41c8-880a-12d804b242c6` (fichiers orphelins, sans ligne) ;
photo mariés `9dabecb9-70db-4487-bb7e-7b65b9e1f9d2` (`maries/thumbs|full/…`) ;
photo suspecte `1d10d393-0d04-4d61-ab03-6e6859377a99` (en attente) ;
photo masquée par signalements `74d6e159-4c4d-4560-b507-74c0f26445b3`.
Lignes `public.photos` : ccd00903…, 577bc358… n'a pas de ligne (doublon), 9dabecb9…, 1d10d393…, 74d6e159… (4 lignes ; les 5 UUID listés par le script incluent le doublon écarté par la base).
