# Recette — état réel au 11 octobre 2026

> **Finitions décoratives du 11 octobre : 160 PASS, 2 ignorés, 0 FAIL (2,9 min).** Quatre suites exécutées : flows, design, lightbox et messages. Les deux cas ignorés sont le test spécifique d’anneau de focus clavier sur les projets mobiles, déjà désactivé par la suite ; il passe sur bureau. Build/syntaxe/empreintes des photos PASS. [Captures avant/après, portée et limites](qa/FINITIONS_GRAPHIQUES.md).

> **Refonte visuelle du 11 octobre 2026 : PASS 120/120** sur Chromium, Chromium mobile et WebKit, dont 18 tests de design aux largeurs 390/768/1440 px. `npm run check`, build et contrôle des fichiers publiés PASS. [Rapport et captures](qa/DESIGN_REVIEW.md). Cette recette utilise des mocks Supabase ; elle ne renouvelle pas la preuve du service distant. Les résultats des interventions précédentes restent consignés ci-dessous.

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

## Correctif « impossible d'envoyer » et bouton « Ajouter mes photos » (11 octobre 2026)

**Cause exacte du blocage** : (1) `config.js` livré avec `SUPABASE_URL` et `SUPABASE_KEY` vides ⇒ `createClient()` renvoie `null`, le bouton « Envoyer » reste
désactivé et seul un petit message en bas de page l'expliquait ; (2) ouverture en `file://` ⇒ le navigateur bloque `app.js` (module) : `Origin null is not allowed by
Access-Control-Allow-Origin`, aucune erreur visible pour l'invité. Reproduit (iPhone 13 WebKit et Pixel 7 Chromium) : config vide ⇒ « Les envois ne sont pas encore ouverts » ;
`file://` ⇒ erreurs CORS ci-dessus ; config réelle servie en HTTP ⇒ sélection puis envoi possibles, aucune erreur console/réseau. `/vendor` et le modèle NSFWJS se chargent (aucun HTTP 4xx/5xx).
Correctif : `config.js` renseigné avec l'URL et la clé **publishable** du projet (valeurs publiques), message explicite si le service n'est pas configuré (encadré rouge, sélecteur inactif),
section 0 de README_DEPLOIEMENT et `npm run preview`.

| Contrôle | Résultat |
|---|---|
| `npm run check` | PASS |
| `npm test` (Chromium, Pixel 7 360 px, iPhone 13 WebKit) | PASS 78, 6 ignorés (pile réelle et projet hébergé, opt-in) |
| Bouton principal visible sans défiler, ≥ 56 px, cuivre, 375×667 | PASS ×3 moteurs |
| Barre flottante visible en défilant (apparaît quand le bouton du héros sort de l'écran), absente sur la page Partager | PASS ×3 |
| Un appui ouvre le sélecteur ; « N photo(s) prête(s) » ; destination rappelée avant l'envoi ; progression ; « Terminé ✓ » | PASS ×3 (client Supabase simulé) |
| Échec : message explicite + « Réessayer les échecs » ; service non configuré : message explicite | PASS ×3 |
| `HOSTED_E2E=1 npx playwright test tests/hosted-e2e.spec.js --workers=1 --project=webkit --project=mobile` | PASS ×2 : envoi réel de bout en bout vers le projet hébergé (Storage + RPC + vrai modèle NSFWJS), « 1 ajoutée(s) à la galerie », miniature affichée, 0 erreur réseau |
| `node scripts/hosted-check.mjs --hosted` (relancé) | PASS 48/48 |
| Safari/Chrome sur téléphones physiques, sélecteur de fichiers iOS natif | NON_TESTÉ |

## Accès administrateur (11 octobre 2026) — GoTrue réel en local

La pile jetable (`bash scripts/real-stack.sh up`) inclut maintenant l'image officielle `supabase/gotrue` 2.158.1 : vrais comptes, vrais mots de passe, vrais JWT, session dans le navigateur.
`tests/real-admin.spec.js` (15 cas = 5 × Chromium / Pixel 7 / iPhone 13) : RPC `admin_status` (public et compte réel non admin ⇒ 42501, admin listé ⇒ données) ;
photo « mariés » illisible pour anon et pour un compte réel non admin, lisible par l'admin ; navigateur : connexion, rechargement avec session, miniature privée chargée par URL signée,
déconnexion (un rechargement ne reconnecte pas) ; compte non admin refusé et déconnecté ; mauvais mot de passe et e-mail non confirmé : messages explicites. **PASS 18/18** avec `tests/real-stack.spec.js`.
`npm test` : 78 PASS, 21 ignorés (opt-in). Connexion admin sur **votre projet hébergé** : NON_TESTÉ (mot de passe non utilisé) ; diagnostic dans ACCES_ADMIN.md.

## Qualité des photos (11 octobre 2026)

**Cause exacte** : (1) les nouvelles photos étaient réduites à **1600 px / JPEG 0,80** en une seule étape de dessin (`drawImage` direct de 4000 px vers 1600 px, sans lissage haute qualité ⇒ crénelage et perte de détail fin) ;
(2) surtout, les **miniatures de 400 px / JPEG 0,70** sont affichées dans des cases **4/5 en `object-fit: cover`** : une photo paysage de 400×300 est agrandie ≈ 2× en hauteur (et 4× sur écran 3×) ⇒ grille floue, et cartes admin idem ;
(3) la lightbox et l'aperçu admin utilisaient bien le fichier **full** (pas la miniature agrandie), mais celui-ci n'avait que 1600 px : sur un iPhone portrait en plein écran (≈ 1170×2530 px physiques) l'image est agrandie 1,6×. Le téléchargement livre le même full 1600. Rien de tout cela n'est récupérable pour les photos déjà envoyées (détail perdu à la compression).

**Corrections** : full 2560 px / q0,85 ; miniature 640 px / q0,75 ; réduction par paliers ≤ 2× en haute qualité ; jamais d'agrandissement ; EXIF respecté (inchangé) ; repli de qualité si > 2,9 Mo ;
lightbox et aperçu admin : miniature immédiate puis haute définition (chargement progressif) ; URL signées des miniatures **conservées** d'un rafraîchissement à l'autre (45 min) pour ne pas retélécharger la grille chaque minute (sinon le poids des miniatures x2,7 aurait gonflé le trafic). Aucune migration, aucune suppression.

Mesure en navigateur (Chromium, `scripts/measure-quality.mjs` + `scripts/quality_report.py`), fidélité (PSNR, dB) contre un redimensionnement Lanczos de la source :

| Photo | Full avant → après (poids) | PSNR full | PSNR miniature |
|---|---|---|---|
| Fixture 4032×3024 (synthétique) | 229 → 697 Ko | 32,8 → 35,5 | 33,7 → 39,2 |
| Fixture portrait EXIF 6 | 219 → 665 Ko | 33,1 → 35,8 | 34,1 → 39,7 |
| Photo 4000×3000 | 127 → 356 Ko | 41,4 → 45,0 | 33,5 → 38,3 |
| Photo 5760×3840 | 148 → 365 Ko | 38,1 → 41,5 | 33,6 → 37,5 |
| 1500×2000 (type WhatsApp) | 477 → 782 Ko | 30,3 → 42,6 | 22,9 → 29,2 |

Poids moyen sur 9 vraies photos (4 grandes + 5 déjà réduites ≈ 1200-1500 px) : **avant** full 375 Ko + miniature 24 Ko ; **après** full **550 Ko** + miniature **66 Ko** (≈ 616 Ko/photo, +54 %). Max observé 782 Ko ; sur la pile réelle, 12 fichiers full : moyenne 555 Ko, maximum 930 Ko.
Estimation du stockage (616 Ko/photo) : **3 000 photos ≈ 1,9 Go ; 5 000 ≈ 3,2 Go ; 10 000 ≈ 6,3 Go** (avant : 1,2 / 2,0 / 4,1 Go). Échantillon petit et peu détaillé : une scène chargée en photo de téléphone peut dépasser 1 Mo en full (≈ 10 000 photos ≈ 10-12 Go). Offre gratuite (1 Go) insuffisante dès ≈ 1 600 photos ; Pro (100 Go) très large.
**Originaux non conservés** : les stocker (3-8 Mo chacun) multiplierait le stockage par 6 à 10 (3 000 photos ≈ 10-25 Go, 10 000 ≈ 40-80 Go, hors du quota gratuit et près de nécessiter un add-on), et la limite du bucket (3 Mo) l'interdit sans migration. Non fait ; à décider avec vous.

| Contrôle | Résultat |
|---|---|
| `npm run check`, `npm test` | PASS 84, 21 ignorés (opt-in) ; dimensions de sortie 640/2560 vérifiées sur 6 photos JPEG/PNG par moteur |
| Test « un rafraîchissement ne re-signe pas les miniatures déjà affichées » ; lightbox miniature puis haute définition | PASS ×3 moteurs |
| Pile réelle (Storage officiel) : envois du nouveau pipeline, lecture par URL signée, **photo privée refusée au public et aux comptes non admin**, téléchargement (`attachment; filename=photo-mariage.jpg`, octets identiques), admin | PASS (`npm run test:real`) |
| Portrait/paysage + EXIF 6 | PASS (dimensions 1920×2560 et 2560×1920 relevées) |
| HEIC natif, iPhone/Android physiques, temps de traitement sur téléphone (≈ 140-220 ms sur ordinateur, à multiplier par 3-5), netteté ressentie en plein écran sur appareil | NON_TESTÉ |
| Envoi réel avec le nouveau pipeline vers le projet hébergé | NON_TESTÉ (aucun fichier supplémentaire déposé) |

## Régression « plus rien n'est visible après une publication » (11 octobre 2026)

**Diagnostic honnête.** Le scénario demandé (2 photos, envoi d'une 3ᵉ, retour galerie, rechargement, lightbox haute définition) a été rejoué **sur la pile réelle** (Storage officiel + PostgREST + PostgreSQL, vrai modèle NSFWJS)
sur Chromium, Pixel 7 et iPhone 13 : **les 3 photos restent visibles, avant et après rechargement, miniatures décodées, lightbox à 2560 px, aucune erreur JavaScript**. Le pipeline 2560/0,85 + 640/0,75, les chemins Storage, les enregistrements `public.photos`,
`gallery_page` et le cache de 45 min des URL signées ne produisent donc **pas** de disparition reproductible : le commit `4211b67` n'est pas démontré fautif.
Lecture publique du projet hébergé (sans écriture) : `gallery_page` renvoie **`[]`** et `list('public/thumbs')` aussi : il n'y a actuellement **aucune photo publiée** sur votre projet (la galerie affiche alors « Le premier souvenir sera le vôtre »).
Une photo envoyée qui reste en `pending_review` (modèle de filtrage indisponible sur le téléphone, pause activée, ou photo jugée suspecte) n'apparaît pas dans la galerie, et l'invité ne voit que « Reçue, elle apparaîtra après validation » : c'est **l'explication la plus probable** de ce que vous observez sur le vrai site.
À vérifier dans le SQL Editor (lecture seule) : `select id, audience, status, review_reason, created_at from public.photos order by created_at desc limit 10;` et `select value from public.app_settings where key = 'publications_paused';`
(`published` + `public` = doit être visible ; `pending_review` + `model_unavailable` / `paused` / `nsfw` = en attente, à publier depuis l'admin, onglet « En attente »).

**Défauts réels trouvés et corrigés** (chacun peut donner l'impression d'une galerie vide) :
1. Avant la première réponse du serveur, ou après un premier chargement en échec, la galerie affichait **« La galerie est encore vide »** : message faux. Remplacé par « Chargement des souvenirs… » / « Les souvenirs n'ont pas pu être chargés », avec **nouvelle tentative automatique** (3 fois, 5 s).
2. Un rafraîchissement demandé pendant un autre (typiquement juste après un envoi, pendant le polling) était **ignoré silencieusement** : il est désormais mis en file et exécuté.
3. Une miniature qui ne se charge pas (signature expirée ou refusée) était simplement masquée, laissant une case vide : elle déclenche maintenant de **nouvelles signatures** (au plus toutes les 20 s).
4. En cas d'échec d'un rafraîchissement, les photos déjà affichées **restent affichées** (testé) et seul le message change.
5. `_headers` : les fichiers JS/CSS étaient servis avec `Cache-Control: max-age=300` alors que le HTML était en `no-cache` : après un déploiement, un navigateur pouvait mélanger un `index.html` neuf avec d'anciens modules (identifiants absents ⇒ erreur JavaScript ⇒ page figée). Désormais `no-cache` partout (revalidation, 304 peu coûteux). **Risque prouvé par lecture, non reproduit.**
Qualité 2560 px / 85 % conservée. Aucune migration, aucune donnée distante modifiée, aucune photo supprimée, RLS inchangée.

| Contrôle | Résultat |
|---|---|
| `npm run check` | PASS |
| `npm test` (Chromium, Pixel 7, iPhone 13 WebKit) | **PASS 102**, 24 ignorés (opt-in : pile réelle, projet hébergé) |
| Nouveaux tests : 3ᵉ photo publiée ⇒ 3 visibles ; rafraîchissement en échec garde les photos ; doublon et envoi privé sans effet ; envoi de 3 photos ; photo mise en attente ; échec réseau pendant l'envoi ; premier chargement en échec puis reprise automatique ; miniature défaillante re-signée ; rendus 390 et 1440 px | PASS ×3 moteurs |
| `npm run test:real` (pile réelle) dont la régression « 3ᵉ photo, rechargement, lightbox à 2560 px » | PASS 21/21 + 54 contrôles HTTP |
| Projet hébergé : envoi réel / affichage de la nouvelle photo | NON_TESTÉ (aucune écriture distante sans votre accord) ; lecture publique : galerie vide |
| iPhone / Android physiques | NON_TESTÉ |

## Déploiement Cloudflare Pages (11 octobre 2026)

Projet `thomas-aziliz-mariage` (Direct Upload, branche de production `main`), créé sur votre compte (le seul projet Pages existant ; aucun autre touché). URL : **https://thomas-aziliz-mariage.pages.dev** ; administration : **https://thomas-aziliz-mariage.pages.dev/admin** (`/admin.html` redirige en 308 vers `/admin`, comportement normal de Cloudflare Pages).
Republier : `npm run deploy` (vérifie la syntaxe, construit, refuse de publier si `config.js` est vide ou si une clé secrète/JWT `service_role` est détectée dans `dist/`, puis `wrangler pages deploy`). `npm run deploy -- --test` lance aussi les tests navigateur.

| Contrôle (automatisé, site en ligne) | Résultat |
|---|---|
| `npm run check`, `npm test` avant publication | PASS, 102 réussis / 24 ignorés (opt-in) |
| `npm run build`, `dist/` : `index.html`, `admin.html`, JS, CSS, polices, `vendor/` (Supabase, NSFWJS, modèle 2,6 Mo), `_headers`, `robots.txt` | PASS, 24 fichiers déposés |
| HTTPS, HTTP/2 ; 17 ressources (JS, CSS, polices, favicon, modèle) en 200 avec le bon type ; URL inconnue = 404 réel | PASS |
| En-têtes réellement servis : CSP, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `nosniff`, `Cache-Control: no-cache` (y compris sur `app.js`) | PASS |
| Aucun secret dans les fichiers publics (seuls URL et clé publishable ; aucun `sb_secret_…` ni JWT `service_role`) | PASS |
| Navigateur iPhone 13 (WebKit) et Pixel 7 (Chromium) émulés sur le site en ligne : accueil, bouton 56 px, galerie (appel `gallery_page` 200 vers le projet Supabase), page Partager, `/admin` avec formulaire, 0 erreur console/réseau | PASS |
| Modèle NSFWJS chargé et exécuté sous la CSP de production (WebKit 0,7 s, Chromium 1,8 s) | PASS |
| Envoi réel de photo, connexion admin avec vos identifiants, téléphones physiques, QR imprimé | NON_TESTÉ (nécessitent votre accord / votre téléphone ; aucune photo de test créée) |
| Galerie en ligne | vide : aucune photo publiée dans le projet Supabase |

## Qualité des photos, 2ᵉ palier : full 3000 px q0,90 + miniatures 800 px (11 octobre 2026)

Constantes de `uploads.js` : `FULL_MAX_SIDE = 3000`, `FULL_QUALITY = 0.90`, `THUMB_MAX_SIDE = 800`, `THUMB_QUALITY = 0.75` (méthode inchangée : paliers ≤ 2×, jamais d'agrandissement, repli de qualité si le fichier dépasse 2,9 Mo).

**Risque vis-à-vis de la limite de 3 Mo du bucket (3 145 728 octets) — mesuré dans Chromium** avec des photos synthétiques bruitées 4032×3024 (basse lumière), `scripts/measure-quality.mjs` :

| Photo de test | Full à q0,90 **sans** repli | Fichier réellement produit | Miniature 800 px |
|---|---|---|---|
| Texture fine | 2 298 Ko | 2 298 Ko | 79 Ko |
| Basse lumière ISO 3200 (bruit courant) | 2 061 Ko | 2 061 Ko | 16 Ko |
| Basse lumière ISO 12800 (très bruitée) | **3 000 Ko** (limite 3 072) | 2 435 Ko (repli) | 34 Ko |
| Bruit gaussien extrême | 3 805 Ko (**dépasse**) | 2 541 Ko (repli) | 62 Ko |
| Bruit pur (pire cas) | 4 526 Ko (**dépasse**) | 2 594 Ko (repli) | 70 Ko |

Conclusion : sans le repli de qualité, une photo très bruitée dépasserait la limite ; **avec** le repli, tous les cas, même le pire, restent ≤ 2 594 Ko (marge ≥ 15 % sous 2 832 Ko, le budget interne). Une photo plus extrême que le bruit pur n'existe pas : au pire un fichier serait refusé côté navigateur avec le message « Photo trop lourde après compression », sans erreur Storage.
**Relever la limite à 5 Mo n'est donc pas nécessaire, aucune migration proposée.** À savoir si vous la voulez quand même : il faudrait modifier **deux** endroits, le bucket (0003, `file_size_limit`) **et** la constante `v_max_object_bytes` de `register_photo` (0002) ; relever seulement le bucket laisserait la base refuser les gros fichiers. Je ne l'ai pas préparé pour éviter un changement de schéma inutile.

**Poids moyen — mesuré** (navigateur, 9 vraies photos de votre dossier : 4 grandes + 5 déjà réduites ≈ 1200-1500 px, donc jamais agrandies) : full **643 Ko** (max 878), miniature **99 Ko** (max 137), soit **≈ 743 Ko par photo** (Pillow, `scripts/estimate_storage.py` : 704 + 101 = 805 Ko ; l'écart vient du moteur JPEG). Les chiffres de stockage ci-dessous sont **mesurés sur cet échantillon, petit et peu bruité** ; au-delà c'est une extrapolation :

| Photos | Stockage (743 Ko/photo) | Si photos bruitées ≈ 2 Mo en full |
|---|---|---|
| 1 300 | ≈ 0,97 Go | ≈ 2,8 Go |
| 3 000 | ≈ 2,2 Go | ≈ 6,3 Go |
| 5 000 | ≈ 3,7 Go | ≈ 10,5 Go |
| 10 000 | ≈ 7,4 Go | ≈ 21 Go |

(`estimate_storage.py` : trafic de la soirée ≈ 7 Go avec 6 chargements de galerie par invité, à doubler les jours suivants : surveiller le quota de trafic.) L'offre gratuite (1 Go) est insuffisante ; Pro (100 Go) très large.

| Contrôle | Résultat |
|---|---|
| `npm run check` | PASS |
| `npm test` | **PASS 111**, 24 ignorés (opt-in) au dernier passage ; dimensions de sortie vérifiées à 800/3000 px |
| `npm run test:real` (Storage/PostgREST/GoTrue réels) | **PASS 21/21** + 54 contrôles HTTP ; lightbox à 3000 px ; moyenne des full de la pile : 1,3 Mo (fixtures synthétiques bruitées 4032 px, max 1,77 Mo < 3 Mo) |
| Netteté ressentie sur téléphone, temps de traitement mobile (≈ 250-520 ms sur ordinateur à 3000 px, à multiplier par 3-5), iPhone « Taille réelle » | NON_TESTÉ |

Note : deux passages intermédiaires ont montré des échecs ponctuels (4 tests de `design.spec.js` pendant qu'un autre processus modifiait la maquette du site ; 4 tests de la pile réelle lancés pendant une autre exécution) ; relancés seuls, tout passe.
**À faire : `npm run build` puis `npm run deploy` pour mettre ces réglages en ligne.** Les photos déjà envoyées gardent leur résolution d'origine.

## Messages d'envoi et lightbox (11 octobre 2026)

**Messages d'envoi** (`uploads.js`, bloc `#upload-message` ; `#upload-status` reste la zone `role="status" aria-live="polite"`) : un seul message à la fois.
Succès complet « N photos ajoutées à la galerie » : disparaît seul après 5 s (fondu 0,4 s, aucune transition avec `prefers-reduced-motion`). Photos en attente : une phrase d'explication, bouton « OK », disparaît seul après 10 s.
Doublons : cités dans le message (« N doublons ignorés (déjà envoyé) »), jamais comme erreur. Échec même partiel ou anomalie (fichier illisible, format refusé, connexion interrompue, trop de photos envoyées) : ne disparaît jamais seul, raison en français, nombre de photos,
« Réessayer les échecs » et « Fermer », les réussites comptées à part (« Bien reçues : … »). Le bloc de progression disparaît quand le message final apparaît ; un nouvel envoi remplace le message ; l'état des photos étant agrégé, une erreur non résolue
réapparaît dans le message final d'un envoi suivant (un succès ne l'efface pas) ; une simple information ne remplace jamais une erreur. Bogue trouvé par les tests et corrigé : après « Fermer », le bouton « Réessayer » de la barre d'outils restait caché.
**Lightbox** : barre d'actions en bas de l'écran (fond sombre à 86 % d'opacité, marge de sécurité iPhone `env(safe-area-inset-bottom)`), « ↓ Télécharger » à gauche (bouton plein), « Signaler cette photo » à droite (discret) ; « Fermer × » en haut à droite (48 px), « 3 / 48 » en haut à gauche ; flèches sur les côtés ; rien ne recouvre le centre de la photo ; swipe, Échap, flèches inchangés. L'aperçu de l'administration garde sa mise en page.

| Contrôle (Chromium 1440 px, Pixel 7 360 px, iPhone 13 WebKit) | Résultat |
|---|---|
| Succès : texte exact, `aria-live=polite`, présent à 3 s, disparu peu après 5 s ; transition > 0 ms, 0 ms en mouvement réduit | PASS ×3 |
| En attente : phrase de raison, « OK » ferme ; sans clic, encore là à 6,5 s, disparu avant ~12 s | PASS ×3 |
| Échec : message toujours présent après 12 s, raison + nombre + « Réessayer les échecs » + « Fermer », un seul bouton de nouvelle tentative visible ; « Fermer » puis réessai depuis la barre d'outils | PASS ×3 |
| Envoi mixte (réussite + échec réseau + doublon + fichier illisible) : un seul message cohérent (« 2 photos n'ont pas pu être envoyées … 1 photo ajoutée … 1 doublon ignoré »), progression masquée | PASS ×3 |
| Nouvel envoi remplace le message ; une erreur survit à un autre envoi ; limite d'envois expliquée et durable ; jamais progression et message final ensemble | PASS ×3 |
| Lightbox : Télécharger et Signaler visibles sans défiler, dans la barre du bas (bas de l'écran), hors de la photo (le centre de la photo est la photo), ≥ 44 px, Fermer en haut à droite, position « 1 / 48 » en haut | PASS ×3 |
| Flèches ≥ 44 px, ne recouvrent ni la barre ni la photo | PASS ×3 |
| Contraste ≥ 4,5:1 (texte « Signaler » sur la barre composée sur blanc et sur noir ; texte « Télécharger » sur son fond ; « Fermer ») avec photo claire et photo sombre ; captures `test-results/lightbox-{bright,dark}-*.png` | PASS ×3 |
| Focus visible (contour ≥ 2 px) sur Télécharger et Signaler, flèches, Échap ; signalement : motifs et annulation ; téléchargement forcé `photo-mariage.jpg` | PASS (clavier : ordinateur et WebKit) |
| Non-régression : `npm test` complet (envoi, pagination, signalement, téléchargement, administration, galerie, design) | **PASS 160**, 26 ignorés (opt-in) |
| `npm run test:real` (Storage, PostgREST, GoTrue réels) avec les nouveaux messages | PASS 21/21 + 54 contrôles HTTP |
| Lecteur d'écran réel (VoiceOver/TalkBack), photo réelle très claire ou très sombre sur téléphone, safe-area d'un vrai iPhone | NON_TESTÉ |

**À faire : `npm run build` puis `npm run deploy` pour publier.**

## Galerie uniforme et lightbox au-dessus du bandeau — 11 octobre 2026

Cette section remplace les réglages et résultats antérieurs pour la présente livraison. Miniatures **640 px maximum / JPEG 0,84**, grands formats **3000 / 0,90**. [Rapport complet : mesures, calcul DPR, cause non reproduite, captures avant/après et recette physique](qa/GALERIE_LIGHTBOX.md).

Paul situe le défaut sous Chrome, au niveau du bandeau Télécharger/Signaler. **NON REPRODUIT sur le commit initial local `c1e9875`** : 24 cas avant modification (4 appareils × 3 formats × initial/rotation), images déjà contenues et sans chevauchement. Cela ne permet pas d'affirmer la cause exacte sur son appareil/site. La nouvelle structure dimensionne explicitement les cadres dans la place restante au-dessus du bandeau et sous Fermer.

| Contrôle / commande | Résultat |
|---|---|
| `node scripts/reproduce-lightbox.mjs c1e9875 http://127.0.0.1:4175` (serveur local 4175 lancé) | **PASS**, 24 mesures ; zéro indice de recadrage/débordement sur la version initiale testée |
| `node scripts/measure-thumbnails.mjs /tmp/wedding-thumbnails http://127.0.0.1:4175` | **PASS**, 14 combinaisons × 7 originaux ; 640/0,84 = 59,5 Ko moyens, 34,7–77,9 Ko ; tableaux/PSNR archivés |
| `PLAYWRIGHT_REUSE=1 npx playwright test --config=playwright.media.config.js --workers=1 --reporter=line` | **PASS 28/28** sur iPhone SE 375×667, iPhone 13 390×664, Pixel 7 412×839, ordinateur 1440×900 |
| Rectangles DOM : 2 portraits, 2 paysages, 1 carré, 4 tailles/orientations de viewport, 4 appareils | **PASS**, 80 mesures ; image hors bandeau/en-tête, sans défilement interne, cadres égaux par orientation et contrôles immobiles |
| Grille 4:5 avec anciens grands fichiers, `cover` vers le haut, lazy/async, dimensions avant/après décodage | **PASS** sur les 4 profils ; tolérance sous-pixel 0,1 px pour les colonnes fractionnaires |
| Clavier, swipe simulé, gestes à 2 doigts non traités comme swipe, blocage du fond et restitution de position | **PASS** sur les 4 profils ; zoom natif autorisé, geste physique NON_TESTÉ |
| Passage 48→49, échec/reprise de pagination, rafraîchissement en cours, retour arrière/fermeture pendant une réponse tardive | **PASS** sur les 4 profils |
| 150 URL distinctes, 7 vrais originaux répétés ; même scénario avec JPEG produits à 640/0,84 | **PASS** chargement et stabilité ; les 150 images sont décodées en fin de chaque scénario |
| Fluidité pendant défilement des 150 miniatures, un worker, aucune charge réseau simulée | **PASS Chromium** sur ce banc (p95 16,8 ms) ; **FAIL fluidité uniforme WebKit headless**, saccades observées (p95 103/117 ms), mieux que les originaux (322/179 ms). **NON_TESTÉ appareils physiques** ; aucune garantie de cadence terrain |
| CLS pendant le défilement | **PASS 0** sous Chromium ; **NON_TESTÉ via cette API sous WebKit**, API indisponible, dimensions fixes vérifiées séparément |
| Suites locales : `PLAYWRIGHT_REUSE=1 npx playwright test tests/flows.spec.js tests/design.spec.js tests/lightbox.spec.js tests/messages.spec.js --output=/tmp/wedding-core-results --reporter=line` (serveur 4173 existant) | **PASS 160**, 2 ignorés (focus clavier non applicable aux projets mobiles) ; envoi public/privé, doublons, NSFW, réseau, état vide, signalement, téléchargement, admin, Axe et responsive |
| `npm run check` ; `npm run build` ; `git diff --check` | **PASS** |
| `sha256sum -c qa/design/photos.sha256` | **PASS**, 7 originaux inchangés |
| `node --check scripts/reproduce-lightbox.mjs` ; `node --check scripts/measure-thumbnails.mjs` | **PASS** |
| Supabase hébergé, migrations, URL signées distantes, Auth/Storage réels | **NON_TESTÉ dans cette mission** ; aucune écriture distante |
| iPhone Safari/Chrome : bandeau, barre d'adresse, rotation, safe-areas, pincement, VoiceOver ; Android Chrome : mêmes contrôles et TalkBack | **NON_TESTÉ**, recette manuelle nécessaire sur les vrais appareils |

Les premiers passages ont détecté une perte de focus Chromium quand la flèche devenait désactivée et des violations Axe sur le fond pendant la fixation du body : corrigées par conservation du focus dans la modale et fond explicitement `inert` puis restauré. Le scénario de réponse tardive vérifie aussi que l'index correspond toujours à la photo courante après un changement pendant le chargement. Les erreurs initiales du nouveau banc (clic sur Précédente déjà désactivée, molette non supportée par WebKit mobile, construction de Touch synthétique) ont été corrigées dans les tests, sans désactiver de contrôle du produit.

Responsive : tests existants 390/768/1440, plus les quatre profils dédiés. Accessibilité : Axe, noms accessibles, focus, modalité et fond inerte ; lecteurs d'écran réels NON_TESTÉ. SEO : titres/descriptions et noindex intentionnel conservés pour l'album privé. Sécurité : RPC et permissions inchangés, aucun secret ajouté ; les mocks ne constituent pas une preuve Storage distante. Performance : aucune nouvelle dépendance, espace réservé, lazy/async et encodage mesuré.

**À faire après recette : rebuilder avec `npm run build`, puis republier uniquement `dist/`. Aucun déploiement ni push n'a été effectué.**

## Lightbox : image entière, marges, plus de bandes latérales (11 octobre 2026)

Correctif CSS uniquement (`app.css`, règles de la lightbox publique). Cause : l'élément `.photo-frame` était dimensionné en JavaScript sur un rapport fixe 2:3 / 3:2 avec un fond sombre `#171b16`, et l'image (`object-fit: contain`) y flottait : toute photo d'un autre rapport (4:5, carré, 3:4) laissait des bandes sombres ; et la zone image touchait le bandeau du bas (0,16 px d'écart mesurés).
Maintenant : lightbox en colonne flex (`100dvh`) : barre du haut, zone image (`flex: 1`, `min-height: 0`, 24 px de marge haut et bas, image centrée), bandeau du bas (`flex: none`, sa hauteur est réservée par le flux) ; `<img>` `width/height: auto`, `max-width/max-height: 100%`, `object-fit: contain`, **sans fond** ; le cadre n'a plus de boîte (`display: contents`, ses dimensions inline sont sans effet), le fond clair vient du conteneur. Flèches, Fermer et bandeau inchangés.

| Contrôle (Chromium, Pixel 7, iPhone 13 WebKit ; 6 formes × 3 écrans) | Résultat |
|---|---|
| Portrait 2:3, 4:5, très haut 1:3 ; paysage 3:2, 16:9 ; carré, sur ordinateur 1920×1080, mobile 390×844 et 360×740 : la boîte de l'image a le rapport exact de la photo (aucune bande), pas de fond sur l'image, le fond à côté de la photo est clair | PASS ×3 |
| Photo entière (repères sur les bords haut et bas), ≥ 24 px d'air au-dessus du bandeau et sous la barre du haut, aucun chevauchement, rien de coupé à gauche/droite, pas de débordement horizontal | PASS ×3 |
| Flèches, Fermer, Télécharger et Signaler restent dans l'écran à leur place | PASS ×3 |
| Le nouveau test échoue bien avec l'ancien CSS (0,16 px d'air au-dessus du bandeau ; rapport de boîte erroné) | confirmé |
| `npm run test` depuis la racine | **PASS 190**, 26 ignorés (opt-in), 0 échec |
| iPhone réel (barre d'adresse Safari dynamique) | NON_TESTÉ ; la hauteur utilise `100dvh` |

## Après l'envoi : la sélection se vide (11 octobre 2026)

`uploads.js` : une fois l'envoi terminé, la liste « Vos photos sélectionnées » ne garde que ce qui demande encore une action : les photos en échec (avec leur message et le moyen de réessayer) et, après un « Annuler », celles pas encore traitées. Les photos envoyées, les doublons et les photos reçues en attente de validation sortent de la liste (aperçus libérés) et le champ fichier est réinitialisé (`input.value = ""`), ce qui permet de rechoisir la même photo. Le bloc (titre et liste) est masqué quand la sélection est vide, y compris au départ.
Nouveau texte (le seul) : « Merci ! Votre photo a bien été ajoutée à la galerie. » / « Merci ! Vos N photos ont bien été ajoutées à la galerie. », qui disparaît seul après 5 s ou dès la sélection suivante ; les messages avec doublon, envoi privé, attente ou échec sont inchangés (un point final en double a été supprimé dans la raison des échecs). Réglages 3000/800 px, Supabase et migrations inchangés.

| Contrôle (Chromium, Pixel 7, iPhone 13 WebKit) | Résultat |
|---|---|
| Envoi réussi : liste vide et bloc masqué (aussi au départ), champ fichier vide, remerciement singulier puis pluriel, il disparaît seul, bouton Envoyer désactivé | PASS ×3 |
| La sélection suivante remplace le remerciement immédiatement | PASS ×3 |
| Échec partiel : seule la photo en échec reste (nom, « Échec », titre « (1) »), « Bien reçues : 1 photo ajoutée à la galerie » ; « Réessayer » l'envoie, liste vidée et masquée | PASS ×3 |
| Même fichier choisi deux puis trois fois de suite (champ vide après chaque envoi) ; le doublon est annoncé | PASS ×3 |
| Photos envoyées visibles dans la galerie sans rechargement | PASS ×3 |
| `npm run test` depuis la racine | **PASS 205**, 26 ignorés (opt-in), 0 échec |
| `npm run test:real` (Storage, PostgREST, GoTrue réels) | PASS 21/21 + 54 contrôles HTTP |
| Sélecteur de fichiers natif iOS/Android (rechoix de la même photo sur téléphone) | NON_TESTÉ |

## Validation avant publication, file « En attente » (11 octobre 2026, branche `moderation-avant-publication`)

Interface uniquement : **aucune migration, `register_photo` et les règles d'accès Supabase inchangés** (le serveur place toujours chaque nouvelle photo publique en attente, raison `paused`, quel que soit le verdict envoyé par le navigateur).
1. Libellés admin : « Activer / Désactiver la validation avant publication », état « Validation avant publication activée : chaque nouvelle photo attend votre validation », raison « En attente de validation », confirmations reformulées.
2. Invité, photo publique mise en attente (validation ou filtre) : « Merci ! Votre photo sera visible après validation. » / « Merci ! Vos N photos seront visibles après validation. » (bouton OK, disparaît après 10 s). Modèle de filtrage indisponible : ancien texte conservé ; autres messages inchangés.
3. File « En attente » : case à cocher sur chaque carte (cible 48 px), barre fixe en bas « Valider (n) » / « Refuser (n) » (boutons 56 px), « Tout sélectionner », un appel par photo avec progression (« Traitement : 2 sur 5… »), rapport (réussites, échecs avec raison, les photos en échec restent cochées), confirmation avant « Refuser » (refuser = masquer, retrouvable dans « Masquées ») et avant de valider des photos signalées par le filtre.
4. Actualisation automatique toutes les 30 s (pas pendant un traitement, une confirmation ou un aperçu) : sélection conservée, aucune reconstruction si rien n'a changé, miniatures non re-téléchargées (signatures conservées 45 min), compteur « En attente (n) » sur l'onglet.
5. Tri : raison `nsfw` d'abord, puis les plus récentes (file lue en une fois, jusqu'à 200). 6. « Récentes » : bouton « Retirer » sur chaque carte, sélection multiple, barre « Retirer (n) » (sans confirmation : réversible via « Masquées »).

| Contrôle (Chromium 1440 px, Pixel 7 360 px, iPhone 13 WebKit) | Résultat |
|---|---|
| Libellés/état/confirmations renommés, aucune trace de « Publications suspendues » | PASS ×3 |
| Compteur d'onglet, ordre nsfw puis récent | PASS ×3 |
| Cases, barre fixe en bas (collée au bas de l'écran), boutons ≥ 52 px et visibles, dernière carte accessible au-dessus de la barre, axe-core 0 violation, tout sélectionner / désélectionner | PASS ×3 |
| Valider en lot : confirmation si photo signalée, annulation sans appel, progression visible, 1 requête par photo, rapport, file vidée | PASS ×3 |
| Refuser : confirmation, masquées et non supprimées ; carte seule : confirmation | PASS ×3 |
| Échecs d'un lot : message, photo restée cochée, nouvelle tentative réussie | PASS ×3 |
| Actualisation 30 s : nouvelle photo nsfw en tête, compteur, cases conservées, mêmes nœuds DOM si rien de neuf | PASS ×3 |
| « Récentes » : Retirer sur chaque carte, barre « Retirer (n) » seule, sans confirmation, onglets sans cases | PASS ×3 |
| Messages invité (validation, filtre, modèle indisponible, échec jamais en succès) | PASS ×3 |
| **Pile réelle** (Storage, PostgREST, GoTrue) : validation activée ⇒ 3 envois « clean » restent `pending_review`, invisibles et non signables ; lot Valider publie 2 ; Refuser cache 1 (non signable) ; validation coupée, photo publiée puis Retirer (non signable) | PASS ×3 |
| `npm run test` depuis la racine | **PASS 244**, 29 ignorés (opt-in), 0 échec |
| `npm run test:real` | **PASS 24/24** + 54 contrôles HTTP |
| Vrai téléphone (iPhone/Android : appui, barre fixe avec la barre d'adresse, défilement), plus de 200 photos en file, projet Supabase hébergé | NON_TESTÉ |

## Barre d'envoi fixe, choix explicite de la destination, suppression en lot (11 octobre 2026, branche `ux-envoi-et-suppression-lot`)

Interface uniquement : aucune migration, `register_photo` et règles d'accès inchangés, 3000/800 px, lightbox et graphisme global inchangés.
**Aujourd'hui avant ce changement** : la destination était un groupe de deux boutons radio placé *avant* le sélecteur de fichiers, « galerie commune » présélectionnée, mémorisée entre deux envois ; elle était lue au clic sur « Envoyer ». Un invité arrivant par « Partager mes photos » voyait le sélecteur de fichiers s'ouvrir sans voir ce choix.
**Maintenant** : à la sélection de photos, une barre fixe apparaît en bas (zone sûre iPhone, `dvh`, défilable si trop haute) avec le groupe radio « Où envoyer vos photos ? » — « Galerie commune : Visible par tous les invités après validation par les mariés. » / « Uniquement aux mariés : Les autres invités ne verront pas cette photo. » —, **aucune option cochée**, le texte « Choisissez où envoyer vos photos » et le bouton unique `#send` (inactif tant que rien n'est choisi ; « Envoyer 3 photos » puis « Envoyer 3 photos vers la galerie commune / les mariés »). Pendant l'envoi la barre montre la progression et « Annuler » existants à la place du choix. Après un envoi qui vide la liste, le choix est oublié ; après un échec partiel il est conservé et la barre propose « Réessayer n photo(s) vers … ». Un seul chemin d'envoi (garde `busy`, destination exigée même pour un `requestSubmit`). La page ne contient plus la section de choix de destination ni le bouton d'envoi d'origine.
**Suppression en lot** : bouton « Supprimer (n) » dans la barre d'actions admin (onglets « En attente » et « Récentes »), sur sa propre ligne, séparée par un filet, en rouge `--danger`, confirmation « Supprimer définitivement N photos ? Les deux fichiers de chaque photo seront effacés du stockage. Cette action est définitive et irréversible. », une requête par photo via la fonction de suppression individuelle (désormais partagée : ligne puis les deux fichiers Storage), progression, rapport ; les échecs restent cochés ; « supprimée de l'album mais fichiers non effacés » compté à part avec le message existant. Actualisation de 30 s suspendue pendant la confirmation et le traitement.

| Contrôle (Chromium 1440 px, Pixel 7 360 px, iPhone 13 WebKit) | Résultat |
|---|---|
| Barre absente sans photo ; avec photo : collée au bas de l'écran, bouton d'envoi visible sans défilement et ≥ 52 px, cartes de choix ≥ 52 px | PASS ×3 |
| La barre ne masque pas le contenu (la dernière photo de la liste défile au-dessus) | PASS ×3 |
| Aucune présélection ; envoi inactif ; `requestSubmit` sans choix n'envoie rien ; libellés singulier/pluriel et rappel de la destination | PASS ×3 |
| Choix modifiable avant l'envoi ; destination appliquée à toutes les photos (chemins `public/` ou `maries/`, `p_audience`) | PASS ×3 |
| Réinitialisation après succès ; nouvelle sélection ⇒ nouveau choix obligatoire | PASS ×3 |
| Un seul envoi : double tap + double soumission ⇒ chaque photo envoyée une fois | PASS ×3 |
| Progression et Annuler dans la barre pendant l'envoi ; barre maintenue si des photos restent | PASS ×3 |
| Échec partiel puis « Réessayer … vers les mariés » : destination conservée, puis réinitialisée | PASS ×3 |
| Doublons séparés par destination ; fichier illisible seul ne fait pas apparaître la barre | PASS ×3 |
| Accessibilité : `group` « Où envoyer vos photos ? » avec 2 radios, clavier (flèches), anneau de focus, axe-core 0 violation (avec et sans choix) | PASS ×3 |
| « Supprimer (n) » : présent dans En attente et Récentes seulement, ≥ 48 px, séparé (≥ 8 px), rouge, axe-core propre ; Valider/Refuser/Retirer inchangés | PASS ×3 |
| Confirmation (nombre, définitif, deux fichiers) ; annulation : aucun appel, sélection gardée | PASS ×3 |
| Lot : 1 requête par photo (ligne puis 2 fichiers), progression, rapport ; échec : la photo reste cochée, nouvel essai réussi, ses fichiers non touchés | PASS ×3 |
| Fichiers non effacés comptés à part avec le message existant ; bouton « Supprimer » d'une carte inchangé | PASS ×3 |
| Actualisation 30 s suspendue pendant la confirmation, reprise ensuite | PASS ×3 |
| **Pile réelle** : destination choisie dans la barre ⇒ chemins `maries/…` / `public/…` et `audience` côté base, privé non signable ; suppression en lot : annulation sans effet, puis lignes supprimées et **les deux objets Storage de chaque photo réellement effacés** (la photo non cochée intacte) | PASS ×3 |
| `npm run test` depuis la racine | **PASS 301**, 35 ignorés (opt-in), 0 échec |
| `npm run test:real` (Storage, PostgREST, GoTrue réels) | **PASS 30/30** + 54 contrôles HTTP |
| Vrai téléphone (barre fixe avec la barre d'adresse, clavier virtuel, appui sur les cartes de choix, sélecteur de fichiers natif), projet Supabase hébergé | NON_TESTÉ |

## Partage : destination d'abord, puis sélecteur de fichiers (11 octobre 2026, branche `partage-destination-et-moderation`)

**Cause de la disparition du choix public/privé (historique Git).** Le kit d'origine plaçait les deux cartes de destination (public présélectionné) avant le bouton de sélection de fichiers. Le commit `8ffbf52` (« bouton Ajouter mes photos : un appui ouvre directement le choix des photos », demande d'ergonomie) a branché `data-pick` sur le bouton de l'accueil, la barre flottante : un clic ouvrait `#files` immédiatement, les cartes restaient en haut de la page Partager, hors de vue. Le commit `0e3e6ca` (point 3 d'une demande suivante) a ensuite déplacé le choix dans la barre fixe *après* la sélection. Ce n'était donc pas un bogue d'un label HTML mais le résultat de ces deux demandes successives ; aucun `label[for=files]` ne subsiste.
**Parcours actuel.** « Partager mes photos » (accueil, barre flottante mobile, lien du menu, URL `/#partager`) mène à l'étape 1 : « Où souhaitez-vous partager vos photos ? », deux grandes cartes (Public / Privé), **rien de présélectionné, aucun sélecteur ouvert**. Un clic sur une carte enregistre la destination puis appelle `files.click()` **de façon synchrone dans le même clic** (aucun `await`, aucun minuteur : le geste utilisateur est encore actif, condition d'iOS Safari et d'Android Chrome). Le champ fichier n'est dans aucun `<label>`. Étape 2 : aperçus, « Vos photos sélectionnées (n) », résumé « n photos à envoyer · Destination : … », retrait d'une photo, « + Ajouter d'autres photos », destination modifiable (radios de la barre fixe), bouton « Envoyer mes photos » ; **aucun envoi automatique**. Annulation du sélecteur (événement `cancel` ou sélection vide) : rien n'est envoyé et le choix de l'étape 1 est de nouveau proposé. Après un envoi qui vide la liste, ou si la liste est vidée, la destination est oubliée ; un nouveau clic sur un point d'entrée de partage revient à l'étape 1 (une sélection non envoyée est conservée, destination affichée). La destination part inchangée au serveur (`p_audience`) et reste identique pendant les tentatives automatiques et le réessai. `register_photo`, RLS et les migrations ne sont pas touchés.

| Contrôle (Chromium 1440 px, Pixel 7 360 px, iPhone 13 WebKit, client Supabase simulé) | Résultat |
|---|---|
| Étape 1 depuis le bouton de l'accueil, la barre flottante (mobile) ou le lien du menu, et par l'URL directe : deux cartes, rien de coché, aucun sélecteur, aucun envoi | PASS ×3 |
| Aucun `label[for=files]`, champ fichier hors de tout label, `aria-hidden`/`tabindex=-1`, un seul champ fichier | PASS ×3 |
| Clic sur la carte Public / Privé : le sélecteur s'ouvre (sélection multiple), destination enregistrée, appel de `input.click()` pendant l'activation utilisateur (`navigator.userActivation.isActive`), pas de minuteur | PASS ×3 |
| Annulation du sélecteur et sélection vide : aucun envoi, étape 1 de retour, nouvel essai possible | PASS ×3 |
| Plusieurs photos : aperçus, compteur, destination affichée, retrait d'une photo ; aucun envoi avant « Envoyer mes photos » (attente de 1,5 s) | PASS ×3 |
| Envoi public : `p_audience = public`, chemins `public/…` ; envoi privé : `maries`, chemins `maries/…`, absent de la galerie publique | PASS ×3 |
| Changement de destination avant confirmation : résumé mis à jour, rien d'envoyé, appliqué à toutes les photos | PASS ×3 |
| Échec puis réessai (tentatives automatiques comprises) : toujours `maries/…` | PASS ×3 |
| Nouveau clic sur un point d'entrée : étape 1 (après envoi, après retrait) ; sélection en attente conservée avec sa destination visible | PASS ×3 |
| Site non configuré : cartes désactivées et explication ; axe-core 0 violation sur l'étape 1 | PASS ×3 |
| **Pile réelle** (Storage, PostgREST, GoTrue) : carte « mariés » puis « public » ⇒ chemins et `audience` en base conformes, le privé n'est pas téléchargeable par un invité | PASS ×3 |
| `npm run test` depuis la racine | **PASS 349**, 35 ignorés (opt-in), 0 échec |
| `npm run test:real` | **PASS 30/30** + 54 contrôles HTTP |
| **Safari iPhone et Chrome Android réels** : ouverture du sélecteur par un appui sur la carte, annulation, HEIC natif | **NON_TESTÉ** (seuls des émulateurs WebKit/Chromium ont tourné ; la conformité au geste utilisateur est vérifiée par `navigator.userActivation`, pas par un appareil) |

## Modération des images : audit du filtre et décision (11 octobre 2026)

Détail et tableaux dans `DETECTEUR_NSFW.md`. Résumé : filtre NSFWJS 4.4.0 / MobileNetV2 dans le navigateur ; un objet (sextoy) est classé `Neutral` car aucune catégorie ne le décrit ; verdict transmis à `register_photo`, qui décide côté serveur. **Aucun détecteur complémentaire n'a été ajouté** : aucune image de positif n'étant disponible, la détection de sextoys n'a pu être mesurée pour aucun modèle ; CLIP zéro-shot (≈ 89 Mo) a produit 1 faux positif sur 16 photos ordinaires. Aucun code de production modifié par cette partie (scripts d'évaluation et documentation seulement).

| Contrôle | Résultat |
|---|---|
| `scripts/evaluate-detector.mjs` sur 16 négatifs (13 photos ordinaires, 3 synthétiques piégeuses) : MobileNetV2 (actuel) / MobileNetV2Mid / InceptionV3 | **0/16 faux positif** pour les trois (Porn+Hentai max 0,087 / 0,046 / 0,067 ; Sexy max 0,713 / 0,004 / 0,062) ; poids 2,6 / 4,3 / 22,4 Mo |
| CLIP ViT-B/32 zéro-shot (`scripts/evaluate-clip-zeroshot.mjs`, expérience hors site) | 1/16 photo ordinaire classée « adult toy » (0,41) ; 3 images abstraites entre 0,10 et 0,17 ; ≈ 89 Mo : **non retenu** |
| Détection de sextoys / contenus explicites par n'importe quel modèle | **NON_TESTÉ** : aucun positif disponible (image du problème non fournie) ; aucune garantie de détection |
| Photo normale publiée seule quand la validation est désactivée ; en attente quand elle est activée (verdict `clean` forcé côté client) | PASS : `tests/messages.spec.js`, `tests/moderation.spec.js`, `tests/real-admin.spec.js` (pile réelle : 3 envois « clean » restent `pending_review`, invisibles, non signables) |
| Photo suspecte ⇒ en attente quel que soit le réglage ; modèle indisponible ⇒ en attente avec message adapté ; message invité de la validation | PASS (`flows.spec.js` verdicts suspect/sexy/indisponible, `messages.spec.js`) |
| Photos en attente : absence d'accès public (galerie, table, Storage, URL signées, URL directes) ; admin : valider, refuser, supprimer | PASS (`scripts/real-http-test.mjs` 54 contrôles, `real-admin.spec.js`, `moderation.spec.js`) ; une vérification dédiée de 55 contrôles (verdicts falsifiés, écritures directes, fonctions admin, course à l'activation, liens signés) a été faite à part sur la pile locale |
| Fuite des photos privées | PASS (`real-http-test.mjs`, `real-admin.spec.js`, `share-flow.spec.js` : chemins `maries/…`, absentes de la galerie) |
| Non-régression générale après la correction du partage | `npm run test` depuis la racine : **349 réussis**, 35 ignorés (opt-in), 0 échec ; `npm run test:real` : **30/30** + 54 contrôles HTTP |
| Mobiles réels, projet Supabase hébergé | NON_TESTÉ |

## Signalement : UN SEUL signalement motivé masque la photo (11 octobre 2026, branche `signalement-premier-suffit`)

Détail, règles, abus, liens signés et migration dans `SIGNALEMENTS.md` ; décision D24 dans `DECISIONS.md`. **Migration `0004_report_first_hides.sql` à appliquer par vous** (SQL Editor, après 0001-0003, puis publier le site) : incrémentale, rejouable, sans suppression de données ; **non appliquée au projet hébergé**.
Audit de l'existant : `report_photo` masquait au 2ᵉ signalement distinct, `admin_set_status('published')` effaçait les signalements, la table avait `unique(photo_id, reporter_id)`, motifs `embarrassing` / `child` / `other`, 20 signalements / 10 min / navigateur. Modifié : motifs et commentaire validés côté serveur, masquage au 1er signalement valide dans la même transaction (verrou de ligne), signalements conservés et résolus à la décision (trace `photo_moderation`), plus de remasquage par d'anciens signalements, frein global (12 photos / 10 min) et 5 signalements / 10 min / navigateur. Inchangés : envois publics/privés, choix de destination, compression, NSFWJS, authentification admin, design général, Cloudflare.

| Contrôle | Résultat |
|---|---|
| Signalement sans motif / motif inconnu / « Autre » sans description (ou < 3 caractères) / commentaire > 500 : refusés **par le serveur** (22023), rien masqué ni enregistré | PASS (SQL T09a–T09b3 ; pile réelle) |
| 1er signalement valide : photo masquée immédiatement et atomiquement (hidden/reports), motif et commentaire enregistrés, fichiers conservés | PASS (SQL T09, T09c, T09d, T11c ; pile réelle) |
| Absente de la galerie, de la lecture directe de la table, du Storage (URL signées, 7 variantes d'URL directes) ; aucun nouveau lien signé ; l'admin peut encore la lire | PASS (SQL T11b–T11e ; pile réelle `real-http-test.mjs`, `real-admin.spec.js`) |
| Administration : miniature, date, motif, commentaire, total / à examiner, statut, dernière décision ; compteur « Signalées (n) » ; commentaire affiché en texte (pas de HTML) ; anciens motifs lisibles | PASS ×3 (`tests/report.spec.js`) |
| Restaurer : visible de nouveau, signalements conservés (résolus), décision tracée ; ancien signalement ne remasque pas ; nouveau signalement valide remasque | PASS (SQL T15–T15h ; `report.spec.js` ; pile réelle navigateur + HTTP) |
| Maintenir masquée (hidden/admin, résolus) ; Supprimer avec confirmation (ligne + deux fichiers, comportement existant) ; lot : Restaurer (n) avec confirmation, Maintenir masquée (n), Supprimer (n) | PASS ×3 (`report.spec.js`) |
| Un invité ne peut ni appeler les fonctions d'administration ni modifier signalements, trace ou statut | PASS (SQL T19, T21c ; `real-admin.spec.js` ; `real-http-test.mjs`) |
| Deux signalements simultanés : un masquage, deux signalements enregistrés ; double clic du même navigateur : un seul signalement ; 4 signalements simultanés sur la pile réelle | PASS (SQL T12 en vrais processus parallèles ; pile réelle) |
| Frein aux abus : 6e signalement d'un navigateur en 10 min, puis plus de 12 photos différentes en 10 min : `rate_limited` | PASS (SQL T22, T22b, T22c ; pile réelle) |
| Migration 0004 sur des données existantes : 3 signalements anciens (motifs historiques) conservés, photos intactes, photo masquée toujours masquée ; rejeu complet 0001→0004 | PASS (SQL T30 + idempotence) |
| Interface invité (Chromium 1440 px, Pixel 7 360 px, iPhone 13 WebKit émulés) : fenêtre « Pourquoi signalez-vous cette photo ? », 5 motifs, rien de coché, bouton inactif (aussi pour un envoi forcé), « Autre raison » : description obligatoire, texte de confirmation exact, photo retirée de la grille, rien d'exposé publiquement, fenêtre dans l'écran, choix ≥ 50 px, axe-core 0 violation | PASS ×3 |
| Liens signés : un lien délivré avant le masquage répond encore (HTTP 200, au plus 3600 s) — **limite documentée, pas une révocation** | INFO vérifié sur la pile réelle |
| `npm run test` depuis la racine | **PASS 391**, 41 ignorés (opt-in), 0 échec |
| `npm run test:real` (Storage, PostgREST, GoTrue réels) | **PASS 36/36** + 63 contrôles HTTP |
| `npm run test:sql` (PostgreSQL 16 jetable, stub) | **PASS 138 lignes**, concurrence T12 comprise |
| Safari iPhone / Chrome Android réels (feuille de signalement, clavier virtuel), projet Supabase hébergé (migration non appliquée) | **NON_TESTÉ** |
