# Galerie et lightbox — 11 octobre 2026

Branche `fix/consistent-thumbnails-lightbox`, commit applicatif `d862eb7`. Corrections locales, sans migration, donnée distante, déploiement ni push. Les sept originaux fournis sont conservés octet pour octet.

## Photo coupée et bandeau du bas

Paul précise que le problème apparaît sous **Chrome**, au niveau du bandeau « Télécharger / Signaler ». Le modèle du téléphone, sa version de Chrome et l'URL concernée ne sont pas connus.

**Le recadrage signalé n'est pas reproduit sur la version locale initiale `c1e9875`.** Avant les modifications, les 24 mesures (4 appareils × 3 formats × écran initial/rotation simulée) montrent déjà `object-fit: contain`, une image au-dessus du bandeau, sous l'en-tête et sans défilement interne. Il serait donc inexact d'attribuer avec certitude ce défaut à `cover`, au bandeau superposé ou à une ancienne version publiée. L'URL/version réellement consultée reste à contrôler sur l'appareil concerné.

Les défauts effectivement constatés et corrigés sont :

- Dimensions déterminées par le ratio individuel de chaque image : deux portraits ou deux paysages n'avaient pas nécessairement le même cadre. Le nouveau cadre portrait est en 2:3 ; paysage et carré utilisent le même cadre 3:2, centré et sombre.
- Pas de verrouillage explicite du fond : le corps est désormais fixé à la position mémorisée pendant l'ouverture, puis remis à sa position de départ à la fermeture. Les éléments du fond sont `inert`, les dialogues restent accessibles.
- Flèche suivante désactivée à la fin des 48 éléments chargés : la page suivante est maintenant chargée au clic, au clavier ou au swipe. Un échec permet de réessayer. Une fermeture ou un changement de photo pendant la requête n'est pas annulé par sa réponse tardive.
- Pendant les tests, perte du focus dans Chromium lorsqu'une flèche devenait désactivée : le focus reste désormais dans le dialogue, ce qui conserve les raccourcis clavier.

**Protection explicite contre le bandeau** : le dialogue utilise `100dvh` avec repli `100vh`. Une grille réserve d'abord la hauteur réelle de l'en-tête, du message et de la barre d'actions. Le cadre est calculé uniquement dans la cellule centrale restante, puis recalculé par `ResizeObserver`. L'image est contenue dans ce cadre, sans transformation initiale. Les espacements intègrent les safe-areas. La place du message est réservée pour que les commandes ne sautent pas à la fin du chargement.

`contain` conserve la totalité de l'image avec des marges éventuelles ; `cover` reste limité aux cases de galerie. Référence : [MDN object-fit](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/object-fit). Le zoom natif reste autorisé par `pan-y pinch-zoom`, sans conversion d'un geste à deux doigts en changement de photo ; [MDN touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action). Le zoom natif déjà appliqué au viewport n'est pas réinitialisé artificiellement entre deux photos : son comportement doit être vérifié sur téléphone réel.

## Miniatures : mesures sur les sept originaux

Encodage JPEG dans Chromium via les mêmes fonctions `canvasFor` et `jpeg` que l'envoi. Réduction par paliers, aucune retouche des originaux. Ko = 1 000 octets. La dimension indiquée est le **côté le plus long**, proportions originales conservées et jamais d'agrandissement. Un côté court fixé arbitrairement à 640 px ferait dépasser 640 px au côté long et augmenterait le poids des portraits allongés.

Le PSNR compare le rendu recadré à 320 × 400 pixels à celui de l'original, à taille identique. Plus haut = moins d'écart dans cette mesure ; ce n'est pas une mesure complète de netteté ressentie. Inspection visuelle complémentaire sur le portrait « sourires à deux ».

| Côté max | Qualité JPEG | Moyenne Ko | Min–max Ko | PSNR moyen dB |
|---:|---:|---:|---:|---:|
| 800 | 0.75 | 65.7 | 37.9–87.4 | 35.79 |
| 640 | 0.84 | 59.5 | 34.7–77.9 | 35.03 |
| 480 | 0.85 | 34.9 | 20.0–44.2 | 32.07 |
| 480 | 0.90 | 43.5 | 25.3–55.5 | 32.63 |
| 480 | 0.93 | 51.5 | 30.2–65.7 | 33.02 |
| 480 | 0.95 | 61.1 | 36.3–77.8 | 33.32 |
| 560 | 0.85 | 48.8 | 28.3–63.1 | 34.00 |
| 560 | 0.90 | 61.1 | 36.2–79.3 | 34.67 |
| 560 | 0.93 | 72.5 | 43.7–94.3 | 35.13 |
| 560 | 0.95 | 86.0 | 53.5–111.6 | 35.45 |
| 640 | 0.85 | 61.4 | 35.9–80.4 | 35.15 |
| 640 | 0.90 | 76.9 | 46.1–101.2 | 35.84 |
| 640 | 0.93 | 91.3 | 56.2–120.2 | 36.31 |
| 640 | 0.95 | 108.5 | 69.2–142.4 | 36.66 |

**Choix : 640 px / qualité 0,84**, moyenne 59,5 Ko, contre 65,7 Ko auparavant à 800 / 0,75 (−9,4 %). C'est le meilleur PSNR mesuré parmi les combinaisons sous 60 Ko de moyenne. Le réglage 640 / 0,85 dépasse légèrement cette cible, à 61,4 Ko. Le poids individuel varie de 34,7 à 77,9 Ko : 60 Ko n'est pas un plafond par fichier.

La qualité de compression augmente, mais la résolution baisse : le PSNR de l'ancien 800 / 0,75 reste légèrement supérieur. Aucune promesse de meilleure netteté dans tous les cas ; le choix optimise le compromis à la taille d'affichage mobile. Les grands fichiers restent à 3000 px / 0,90. Les anciennes miniatures continuent à s'afficher sans réencodage.

### Dimension réelle des cases sur iPhone

Conteneur = écran − 40 px ; espace entre cases = 8 px. Ratio de case 4:5.

| Écran | Colonnes | Largeur CSS | Largeur × hauteur à DPR 3 |
|---|---:|---:|---:|
| 375 px | 2 | 163,5 px | 490,5 × 613,1 px |
| 390 px | 2 | 171 px | 513 × 641,3 px |
| 375 px | **3** | **106,3 px** | **319 × 398,8 px** |
| 390 px | **3** | **111,3 px** | **334 × 417,5 px** |

Trois colonnes retenues sur mobile ; quatre sur grand écran. Un portrait 2:3 à 640 px donne 427 × 640 px, un paysage 3:2 donne 640 × 427 px : ils couvrent les besoins des trois colonnes. Les formats très étroits peuvent manquer de pixels sur le côté court (exemple 908 × 2016 → 288 × 640) ; on conserve leurs proportions et la photo entière dans la lightbox. La galerie recadre seulement à l'affichage, vers le haut du centre (`50% 35%`). Les grandes cases asymétriques ont été supprimées.

## Vérifications et captures

Les tests dédiés utilisent iPhone SE 375 × 667, iPhone 13 390 × 664 (viewport du profil Playwright), Pixel 7 412 × 839 et ordinateur 1440 × 900. WebKit pour les iPhone ; Chromium pour Pixel et ordinateur. Ils mélangent deux portraits, deux paysages et un carré. Les repères « HAUT/BAS » et les bordures doivent rester visibles.

Les rectangles DOM contrôlent : image dans la zone centrale, au-dessus des actions, sous l'en-tête et Fermer, sans défilement interne. Les dimensions sont comparées entre deux portraits, deux paysages et un carré. Contrôles supplémentaires après échange largeur/hauteur, réduction de hauteur de 100 px et retour à la taille initiale ; les actions et flèches restent fixes au changement de format.

Dimensions relevées à l’ouverture (la photo peut laisser des bandes dans son cadre) :

| Viewport | Cadre portrait CSS | Cadre paysage/carré CSS |
|---|---:|---:|
| iphone-se | 245.0 × 367.5 px | 245.0 × 163.3 px |
| iphone-13 | 260.0 × 390.0 px | 260.0 × 173.3 px |
| pixel-7 | 282.0 × 423.0 px | 282.0 × 188.0 px |
| desktop | 478.0 × 717.0 px | 1075.5 × 717.0 px |

- Avant : `lightbox/before/`, `lightbox/before.json`, `lightbox/before-rotated/` et `lightbox/before-rotated.json`.
- Après : `lightbox/after/<appareil>/`, avec captures, `geometry.json` et `scroll-timing.json`.
- Mesures JPEG complètes par original : `lightbox/thumbnails.json`.

### Galerie de 150 photos

150 URL distinctes réutilisent les sept originaux, ce qui teste aussi la compatibilité avec des fichiers bien plus grands que les nouvelles miniatures. Ce scénario charge environ 30 Mo si tous les fichiers sont récupérés, contre environ 8,9 Mo pour 150 nouvelles miniatures à la moyenne mesurée. Le lazy loading reste actif.

Mesure locale headless, un seul worker, 179 intervalles `requestAnimationFrame` pendant le défilement. Aucun profil de réseau ni de CPU de téléphone n'est simulé : les chiffres décrivent ce banc de test, pas les performances d'un vrai iPhone ou Android.

| Profil | Images | Intervalle p95 (ms) | Maximum (ms) | Intervalles >50 ms | CLS mesuré |
|---|---|---:|---:|---:|---|
| iphone-se | original | 322.0 | 374.0 | 64/179 | API indisponible |
| iphone-se | thumbnail | 103.0 | 108.0 | 57/179 | API indisponible |
| iphone-13 | original | 179.0 | 226.0 | 51/179 | API indisponible |
| iphone-13 | thumbnail | 117.0 | 148.0 | 61/179 | API indisponible |
| pixel-7 | original | 16.8 | 50.0 | 0/179 | 0 |
| pixel-7 | thumbnail | 16.8 | 16.8 | 0/179 | 0 |
| desktop | original | 16.8 | 49.8 | 0/179 | 0 |
| desktop | thumbnail | 16.8 | 16.8 | 0/179 | 0 |

Les 150 images sont décodées en fin de parcours dans chaque scénario. Les miniatures sont générées au début du test avec les constantes réelles de `uploads.js`, puis servies localement via les mocks. **Fluidité : saccades observées sous WebKit headless même avec les miniatures** ; amélioration par rapport aux originaux, mais aucun PASS de fluidité physique iPhone ne peut être donné. Le défilement Chromium est proche de 60 Hz dans ce test. CLS nul là où l’API est disponible ; dimensions des cases stables contrôlées séparément sur les quatre profils.

### Commandes reproductibles

Depuis la racine du kit, démarrer `python3 scripts/serve.py --port 4175` dans un terminal séparé, puis :

```bash
node scripts/reproduce-lightbox.mjs c1e9875 http://127.0.0.1:4175
node scripts/measure-thumbnails.mjs /tmp/wedding-thumbnails http://127.0.0.1:4175
PLAYWRIGHT_REUSE=1 npx playwright test --config=playwright.media.config.js --workers=1 --reporter=line
```

La mesure JPEG écrit les dérivés dans `/tmp`, pas dans les originaux ni dans Storage. Le script de reproduction sert le HTML/CSS/JS du commit initial en interception locale ; il ne change pas la branche. Les mocks interceptent Supabase.

Résultats finaux : **28/28 tests dédiés PASS** ; **160 tests de non-régression PASS, 2 ignorés** (focus clavier sur les projets mobiles). `npm run check`, `npm run build`, `git diff --check` et vérification SHA-256 des sept originaux : **PASS**. La fluidité uniforme WebKit headless reste **FAIL** dans le scénario de défilement décrit, indépendamment du succès des assertions fonctionnelles. Aucun échec fonctionnel restant dans les suites exécutées.

Non-régression (si le serveur 4173 existe déjà, comme lors de cette passe) :

```bash
PLAYWRIGHT_REUSE=1 npx playwright test tests/flows.spec.js tests/design.spec.js tests/lightbox.spec.js tests/messages.spec.js --output=/tmp/wedding-core-results --reporter=line
```

Sinon retirer `PLAYWRIGHT_REUSE=1` pour laisser Playwright démarrer le serveur. Aucun test distant n'est lancé par cette commande.

## À vérifier sur les vrais téléphones — NON_TESTÉ

- **iPhone Safari et Chrome** : ouvrir une photo verticale depuis le bas de la galerie ; vérifier les pieds et le sommet de l'image, le bandeau et Fermer ; faire apparaître/disparaître la barre d'adresse, pivoter dans les deux sens, puis refermer et vérifier la position de retour. Tester les safe-areas réelles, le pincement, le déplacement après zoom, le retour au zoom initial, les swipes, VoiceOver et le téléchargement dans Photos/Fichiers.
- **Android Chrome** : même parcours avec barre d'adresse mobile, rotation, pincement/TalkBack et téléchargement. Vérifier l'absence de bas d'image masqué par la navigation système et la fluidité de 150 photos avec un réseau mobile.
- Les redimensionnements Playwright et gestes synthétiques ne prouvent pas le comportement des barres du navigateur ni les gestes physiques. Le signalement Chrome précis ne pourra être déclaré reproduit/résolu sur l'appareil qu'après cette recette.
- Auth, Storage et URL signées distantes : aucune nouvelle vérification distante dans cette mission. Les non-régressions utilisent les mocks ; aucune migration n'a été modifiée.

Sécurité : mêmes RPC, mêmes règles de confidentialité, aucun secret ajouté ; arrière-plan inaccessible pendant le dialogue. Accessibilité : contrôles nommés, focus clavier, modalité explicite, fond inerte puis restauré. SEO : titres, descriptions et `noindex,nofollow` intentionnels de cet album privé conservés. Responsive : contrôles dédiés sur les quatre appareils, plus les largeurs 390/768/1440 des tests existants. Performance : pas de dépendance supplémentaire, JPEG mesurés, lazy/async, cases réservées avant décodage.

**Après validation : rebuilder avec `npm run build`, puis republier uniquement `dist/`. Aucun déploiement n'a été effectué par cette mission.**
