# Finitions graphiques — Thomas & Aziliz — 11 octobre 2026

## Périmètre

Le dépôt était propre au démarrage, au commit `4b23cc2`, après les commits de stabilisation des messages d’envoi, de la lightbox et de la configuration Cloudflare. Aucun test ni serveur de développement tiers n’était actif lors du contrôle. Une branche dédiée a été créée : `feat/thomas-aziliz-decorative-finish`.

Cette intervention enrichit seulement la décoration. Les photographies, le HTML, les libellés, la navigation et les fonctions JavaScript restent identiques à cet état initial. Aucun changement Supabase, Auth, compression, NSFWJS, modération ou Cloudflare.

## Changements visuels

- Fonds du hero, de la bande Polaroid et du footer légèrement nuancés en champagne et sauge, avec maintien de la texture de papier existante.
- Petit rameau floral SVG réutilisé entre les sections, au-dessus du formulaire et dans le footer public. Aucun nouvel ornement floral dans l’administration.
- Filets champagne sous les titres, séparateurs plus doux et contours du portrait affinés.
- Ombres délicates sur les Polaroids, cartes de destination, conseils et cartes administratives.
- Statistiques administratives sur de petits fonds encadrés, sans modifier leur disposition.
- États survol/appui plus soignés. Transitions courtes uniquement lorsque la réduction des animations n’est pas demandée ; effets de survol réservés aux pointeurs adaptés.

Les ornements sont non interactifs (`pointer-events: none`) et les décorations du hero restent derrière les textes, les boutons et le portrait. Les sept fichiers photographiques sont inchangés, confirmé par SHA-256.

## Avant / après

Captures réelles Chromium, réalisées sur la même base applicative avant et après le CSS. Les données Supabase sont simulées : les écrans vides ne décrivent pas le contenu du service distant. Les neuf paires ont **exactement les mêmes dimensions** ; aucune hauteur de page n’a changé.

| Page / largeur | Avant | Après |
|---|---|---|
| Accueil — 390 px | [Avant](finish/before/home-390.png) | [Après](finish/after/home-390.png) |
| Partage — 390 px | [Avant](finish/before/share-private-390.png) | [Après](finish/after/share-private-390.png) |
| Administration — 390 px | [Avant](finish/before/admin-390.png) | [Après](finish/after/admin-390.png) |
| Accueil — 1440 px | [Avant](finish/before/home-1440.png) | [Après](finish/after/home-1440.png) |
| Partage — 1440 px | [Avant](finish/before/share-private-1440.png) | [Après](finish/after/share-private-1440.png) |
| Administration — 1440 px | [Avant](finish/before/admin-1440.png) | [Après](finish/after/admin-1440.png) |
| Accueil — 768 px | [Avant](finish/before/home-768.png) | [Après](finish/after/home-768.png) |
| Partage — 768 px | [Avant](finish/before/share-private-768.png) | [Après](finish/after/share-private-768.png) |
| Administration — 768 px | [Avant](finish/before/admin-768.png) | [Après](finish/after/admin-768.png) |

## Fichiers applicatifs

- `app.css` : un bloc de finitions isolé en fin de feuille, sans changement des règles de mise en page.
- `assets/botanical-sprig.svg` : illustration locale de **1 386 octets**, sans script ni ressource externe.
- `scripts/build.mjs` : ajout de ce SVG à la liste des ressources copiées.

Aucune dépendance ajoutée. L’ajout CSS pèse 4 310 octets bruts, soit une augmentation de 1 044 octets dans le CSS gzip. Aucun nouveau traitement JavaScript, aucune photographie alourdie. Les ressources de QA ne sont pas copiées dans `dist/`.

Les titres HTML, textes alternatifs, labels, focus, tailles tactiles, métadonnées et consignes de non-indexation sont conservés. Les photos ne sont jamais modifiées ni remplacées.

## Recette

| Contrôle | Résultat |
|---|---|
| Captures de référence, `tests/design.spec.js`, Chromium | PASS 6/6 avant modification |
| Aperçu après finition, même suite | PASS 6/6 |
| Suite finale : flows + design + lightbox + messages | **PASS 160**, **2 ignorés**, 0 FAIL, en 2,9 min |
| Cas ignorés | NON TESTÉ : le scénario dédié à l’anneau de focus clavier est désactivé par la suite existante pour les deux projets mobiles (`isMobile`). Il passe sur Chromium bureau. |
| `npm run check` et `npm run build` | PASS |
| axe-core, contrastes et cibles tactiles de la lightbox | PASS dans les scénarios exécutés |
| Réduction des animations et parcours public/privé | PASS |
| Responsive à 390/768/1440 px | PASS, absence de débordement et revue des captures |
| Dimensions des neuf paires avant/après | PASS, strictement identiques |
| Identité des sept photographies, SHA-256 | PASS |
| Comparaison HTML/JS/config/Cloudflare/dépendances avec `4b23cc2` | PASS, aucune modification |
| SVG présent dans le build, QA exclue du build | PASS |
| `git diff --check` | PASS |

La recette automatisée couvre l’accueil, le partage public/privé, la galerie, l’administration, la lightbox, les dernières confirmations d’envoi, les erreurs et réessais. Les tests Supabase utilisent des mocks ; le test d’inférence NSFW charge le modèle local réel.

Commandes reproductibles depuis le dépôt :

```sh
npm run check
npm run build
npx playwright test tests/flows.spec.js tests/design.spec.js tests/lightbox.spec.js tests/messages.spec.js --reporter=line
sha256sum -c qa/design/photos.sha256
```

La passe de livraison utilise la configuration temporaire déjà documentée dans `DESIGN_REVIEW.md` : port 4175 et sortie `/tmp/wedding-design-results`, pour isoler le serveur de recette. Le résumé est conservé dans [finish/validation.txt](finish/validation.txt).

**NON TESTÉ dans cette mission :** Supabase/Storage distants, appareils physiques, lecteur d’écran et performances réseau terrain. Aucun audit de dépendances supplémentaire : aucune dépendance n’a changé. Les limites déjà documentées dans CHECKLIST_TESTS restent applicables.

**Aucun déploiement.** Examiner les captures avant/après puis valider explicitement la publication si souhaitée.
