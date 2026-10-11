# Revue de la refonte — Thomas & Aziliz — 11 octobre 2026

## Résultat livré

Accueil ivoire/champagne/sauge, grand portrait original, motifs botaniques SVG et sept Polaroids. Les trois liens publics sont Accueil, Partager des photos et Galerie. Le partage reste prioritaire dès le premier écran de téléphone. Le formulaire présente d’abord la destination publique ou privée, puis la sélection, les aperçus et l’envoi. L’administration utilise les mêmes couleurs.

Les sept JPEG sont copiés **octet pour octet** depuis les fichiers fournis. Aucune retouche générative ou recompression. Les empreintes sont conservées dans [photos.sha256](design/photos.sha256). Le cadrage d’affichage est réalisé en CSS. La bande de présentation et la galerie des invités restent deux conteneurs distincts ; aucun original de présentation n’est inséré dans Supabase.

La maquette claire évoquée dans la mission n’est pas présente dans les pièces jointes accessibles. Les sept photographies et le texte de la mission ont servi à cette réalisation ; une reproduction exacte d’une référence graphique non consultée ne peut pas être affirmée.

## Captures réelles du navigateur

Captures Chromium du site local, sans montage. Les photos de présentation sont les vrais originaux. **Les données Supabase sont simulées pour la recette** : les écrans vides ne décrivent pas l’état du service distant. Les fichiers suffixés `mock` emploient les fixtures abstraites existantes, exclusivement pour contrôler la grille, la lightbox et les actions. Ces fixtures et ces captures ne sont pas publiées par le build.

| Écran | Mobile 390 px | Tablette 768 px | Bureau 1440 px |
|---|---|---|---|
| Accueil + Polaroids + galerie vide | [Voir](design/home-390.png) | [Voir](design/home-768.png) | [Voir](design/home-1440.png) |
| Partage, destination privée sélectionnée | [Voir](design/share-private-390.png) | [Voir](design/share-private-768.png) | [Voir](design/share-private-1440.png) |
| Administration | [Voir](design/admin-390.png) | [Voir](design/admin-768.png) | [Voir](design/admin-1440.png) |
| Galerie remplie — mocks | [Voir](design/gallery-mock-390.png) | [Voir](design/gallery-mock-768.png) | [Voir](design/gallery-mock-1440.png) |
| Lightbox — mocks | [Voir](design/lightbox-mock-390.png) | [Voir](design/lightbox-mock-768.png) | [Voir](design/lightbox-mock-1440.png) |
| Modération de photos — mocks | [Voir](design/admin-mock-390.png) | [Voir](design/admin-mock-768.png) | [Voir](design/admin-mock-1440.png) |

## Vérifications

| Contrôle | Statut | Preuve / limite |
|---|---|---|
| `npm run check` | PASS | Syntaxe des quatre modules applicatifs. |
| `npm run build` | PASS | Photos, SVG et styles présents dans `dist/`, références locales résolues. Tests, SQL, fixtures, captures et documentation exclus. |
| `tests/flows.spec.js` + `tests/design.spec.js` | PASS | **120/120**, 1,7 min : 40 scénarios × Chromium bureau, Chromium mobile et WebKit iPhone émulé. 102 cas existants + 18 nouveaux cas visuels. |
| Responsive | PASS | Aucun débordement horizontal du document aux trois largeurs ; 360 et 375 px couverts aussi par la suite existante. Zone Polaroid défilante dans son propre conteneur. |
| Partage et confidentialité | PASS local | Destinations publique/privée, doublons, réessais, erreurs, annulation et absence des privés dans la galerie, via mocks. Les politiques Supabase n’ont pas été modifiées par la refonte. |
| Galerie et administration | PASS local | Pagination, rafraîchissement, retour après publication, signatures simulées, téléchargement, lightbox/clavier/swipe, signalement, masquage/restauration/suppression/pause, refus non-admin et déconnexion. |
| Accessibilité | PASS automatisé | Zéro violation axe-core dans les vues contrôlées, y compris lightbox et administration remplie. Un h1 visible, labels, textes alternatifs, focus et commandes tactiles préservés. |
| Identité des originaux | PASS | Comparaison SHA-256 avec les sept fichiers sources, puis comparaison binaire entre sources du projet et build. |
| Sécurité du changement | PASS périmètre | Aucun changement de SQL/RLS/RPC, Auth, `shared.js`, `admin.js`, en-têtes CSP ou dépendances. Aucune nouvelle clé. Le build conserve son refus des clés privées. |
| SEO | PASS | Titre et description personnalisés ; contenu principal HTML, titres par vue. `noindex,nofollow` et robots conservés pour cet album privé d’événement ; pas de sitemap ni données structurées d’un faux événement public. |
| Performance | PASS structure | Aucune dépendance ajoutée, polices locales, portrait prioritaire de 297 465 octets, Polaroids lazy avec dimensions réservées. Les sept photos totalisent 1 404 642 octets ; le portrait est réutilisé par URL dans la bande. Modèle NSFW chargé à la demande comme avant. |
| `git diff --check` | PASS | Aucun défaut d’espacement. |
| Échec restant lié à la refonte | Aucun FAIL | Voir les corrections ci-dessous. Les audits/dettes préexistants restent consignés dans CHECKLIST_TESTS. |
| Storage/Auth distants et SQL | NON TESTÉ dans cette mission | Aucun nouveau test distant, aucune migration, aucune écriture distante. Les mocks ne constituent pas une preuve du service Storage réel. |
| Appareils physiques, lecteur d’écran, débit mobile et Core Web Vitals terrain | NON TESTÉ | La recette navigateur émule les appareils ; elle ne remplace pas un iPhone/Android physique. |
| Fidélité exacte à la maquette claire | NON TESTÉ | Image de référence absente des pièces jointes disponibles. |
| Publication | NON TESTÉ / non effectuée | Aucun déploiement de cette refonte ; validation de Paul requise. |

## Défauts détectés puis corrigés

- Le nouveau lien Galerie depuis le formulaire réaffichait l’accueil sans atteindre les photos : défilement explicite après réaffichage du conteneur, testé aux trois tailles et sur les trois projets.
- Un saut de ligne HTML collait deux mots dans le texte accessible du h1 : espace ajouté.
- Le cadre du portrait était étiré inutilement en hauteur sur tablette : alignement vertical corrigé.
- Les tests ont été adaptés aux nouveaux libellés, à la couleur sauge et à la présence de photos décoratives sans remplir la galerie. Les captures dédiées attendent le décodage des images, y compris les Polaroids lazy hors écran.
- Un premier lancement a échoué parce que le serveur 4173 utilisé par un autre processus s’est arrêté. La passe finale utilise un serveur dédié sur 4175 et une sortie isolée ; aucun processus tiers n’a été interrompu.

## Reproduire

Depuis le dépôt, avec les dépendances/fixtures déjà préparées comme indiqué dans le README :

```sh
npm run check
npm run build
npx playwright test tests/flows.spec.js tests/design.spec.js --reporter=line
sha256sum -c qa/design/photos.sha256
```

Le serveur Playwright démarre sur 4173. Ne pas lancer simultanément une autre recette sur ce même port et ce même dossier de résultats. Pour la passe de livraison, une configuration temporaire importait `playwright.config.js` en ne remplaçant que `use.baseURL` et `webServer` par `http://127.0.0.1:4175`, ainsi que `outputDir` par `/tmp/wedding-design-results`. Le résumé de cette passe est dans [design-validation.txt](design-validation.txt).

## Périmètre Git et prochaine action

Branche dédiée : `feat/thomas-aziliz-ivory-design`.

- `2fbbfc4` : interface et photos originales.
- `a09e310` : tests adaptés et nouveaux scénarios de design.
- Commit documentaire : `docs: deliver design screenshots and validation report`.

Les modifications de qualité photo déjà en cours ont été préservées, puis enregistrées séparément par l’autre processus dans `4c7080a`. Elles ne font pas partie de cette refonte graphique.

Examiner les captures et valider le rendu avant publication. Conserver ensuite la recette sur iPhone/Android, le contrôle des accès privés et la validation du QR avant le 25 octobre. Aucune nouvelle fonctionnalité n’est nécessaire pour cette livraison visuelle.
