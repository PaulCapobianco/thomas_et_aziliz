# Recette — état réel au 11 octobre 2026

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
