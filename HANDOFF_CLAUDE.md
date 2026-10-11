# Livraison et audit ciblé — 11 octobre 2026


> **État courant — galerie/lightbox, 11 octobre 2026.** Branche `fix/consistent-thumbnails-lightbox`, commit applicatif `d862eb7`. Validation finale : 28 tests dédiés PASS + 160 non-régressions PASS, 2 ignorés ; build/check PASS. Grille uniforme 4:5 (3 colonnes mobiles), miniatures 640/0,84 mesurées sur les 7 originaux (59,5 Ko en moyenne), grands formats 3000/0,90 conservés. Cadres portrait 2:3 et paysage/carré 3:2 calculés dans la place restante entre l’en-tête et le bandeau, fond bloqué puis restauré, pagination automatique en lightbox et protection contre les réponses tardives. Le recadrage Chrome signalé au niveau du bandeau n’est pas reproduit sur le commit initial local : ne pas inventer de cause distante. Voir [rapport, mesures et captures](qa/GALERIE_LIGHTBOX.md) et la dernière section de CHECKLIST_TESTS pour les résultats actuels ; les résultats ci-dessous sont historiques. Aucun changement SQL/service distant, aucune publication ni push. La recette physique iPhone/Android et la fluidité WebKit restent à valider.

> **Dernière intervention : finitions décoratives uniquement**, branche `feat/thomas-aziliz-decorative-finish`, base propre `4b23cc2`. Un bloc CSS, un SVG local de 1,4 Ko et son inclusion dans le build. HTML/JS applicatifs, libellés, photos, Supabase et Cloudflare inchangés. Recette : 160 PASS / 2 ignorés ; voir [avant/après et limites](qa/FINITIONS_GRAPHIQUES.md). Aucun déploiement.

## Reprise après la mission corrective graphique du 11 octobre 2026

La direction actuelle est **ivoire, champagne et sauge** ; elle remplace les anciens choix sombres. Thomas & Aziliz et les sept photos originales sont intégrés sans retouche. La bande Polaroid est décorative et indépendante de `#gallery`. Destination avant sélection sur le formulaire ; administration harmonisée. Auth, RPC/RLS, logique d’envoi, compression et modération n’ont pas été modifiés par cette refonte.

Branche : `feat/thomas-aziliz-ivory-design`. Recette finale : **120/120 PASS**, avec mocks Supabase et modèle NSFW local réel ; pas une nouvelle recette distante. Build et syntaxe PASS. Voir [rapport, limites et 18 captures](qa/DESIGN_REVIEW.md) et [direction graphique](assets/DESIGN_NOTES.md). Le travail préexistant sur la qualité photo a été préservé dans son commit séparé. Aucun déploiement de la refonte : attendre la validation explicite de Paul. Les rubriques suivantes documentent les états antérieurs ; leurs mentions de prénoms/configuration absents et de fallback sombre sont désormais historiques.


## 1. FONCTIONNALITÉS TERMINÉES (preuve de fonctionnement)

Trois écrans réalisés : accueil/galerie premium, partage public/privé, administration. Lightbox, navigation clavier/tactile, téléchargement signé, sélection multiple, compression 1600/400, SHA-256 original, dédoublonnage, modèle NSFW local différé, attente sûre si indisponible, progression du lot, erreurs/retries et annulation. Signalements via RPC, admin Auth avec listes, masquage/restauration/suppression confirmée, pause/reprise et libération contrôlée.

Preuves locales : 60 tests navigateur complets PASS après les derniers correctifs de focus/polling et de destination des réessais, sur Chromium bureau/mobile et WebKit ; modèle réel chargé sur les deux moteurs. SQL : 117 assertions du kit + concurrence T12 PASS. Les tests qui utilisent Supabase sont **mockés côté navigateur**, et les tests SQL utilisent le **stub local**. Aucun fonctionnement distant n'est affirmé. Détail et sorties : `CHECKLIST_TESTS.md`, `qa/verification.txt`.

## 2. FICHIERS CRÉÉS/MODIFIÉS

- Produit : `index.html` remplacé ; nouveaux `admin.html`, `app.css`, `app.js`, `uploads.js`, `admin.js`, `shared.js`, `config.js`, `404.html`, `assets/favicon.svg`, `_headers`, `robots.txt`.
- Outillage : `package.json`, `package-lock.json`, `playwright.config.js`, `tests/flows.spec.js`, `tests/mock.js`, `scripts/vendor.mjs`, `scripts/build.mjs`, `scripts/serve.py`, `scripts/test-sql.sh`, `scripts/verify-storage.mjs`, `.gitignore`.
- Ajustements du kit : `scripts/vendor.sh` fonctionne avec les paquets réels ; `scripts/estimate_storage.py` distingue les hypothèses et échoue proprement sans image valide ; `supabase/tests/run_local.sh` n'ignore plus une erreur d'assertion SQL.
- Livraison : `README.md`, `ARCHITECTURE.md`, `DECISIONS.md` (D01–D23 recopiées), `README_DEPLOIEMENT.md`, `CHECKLIST_TESTS.md`, `ACTIONS_HUMAINES.md`, `GUIDE_TEMOIN.md`, ce document et `qa/verification.txt`.
- Générés, ignorés : `vendor/`, `fonts/`, `fixtures/`, `dist/`, `test-results/`. Recréation par les commandes du README.
- **Migrations SQL 0001–0003 inchangées**, Edge Function du plan B inchangée, maquettes et textes de référence conservés.

## 3. ARCHITECTURE ET CHOIX TECHNIQUES

HTML/CSS/JS natifs, aucune réécriture framework. `#galerie` et `#partager` préservent `?k=` ; `/admin.html` distinct. Pas de photo/prénom fictif, fallback éditorial sans image cassée. Le vrai couple pourra être renseigné dans `config.js`.

Contrat Supabase V3 strict : bucket privé, galerie RPC/keyset, écritures par RPC, signatures 1 h. `uploadObject()` est le seul point de remplacement pour le plan B. Admin et invité ont des clients séparés : les privilèges de la session admin ne doivent jamais servir à la galerie publique. Session admin dans sessionStorage, repli mémoire. Nettoyage des suppressions best effort explicite.

Responsive vérifié à 360/768/1440 px sur les trois écrans ; images lazy, polices locales, aucune bibliothèque IA au chargement initial. Navigation et dialogs accessibles, zéro violation axe détectée. Titres/descriptions présents ; album volontairement noindex, sans sitemap/JSON-LD/OG personnel. Perf : bundle NSFW/TensorFlow ~296 Ko gzip différé + modèle ~2,6 Mo non compressés. Le polling peut coûter du trafic ; estimation documentée.

## 4. TESTS EXÉCUTÉS : commande + PASS / FAIL / NON TESTÉ

| Commande | Résultat |
|---|---|
| `npm run check` | PASS syntaxe JS |
| `npm run vendor` | PASS, auto-hébergement et exclusion argparse/sprintf-js |
| `npm run build` | PASS, sortie dist filtrée, warning config manquante attendu |
| `npm run test:sql` | PASS, 117 assertions + T12, PostgreSQL 16, migrations rejouées |
| `npm test -- --reporter=line` | PASS, 60/60, 40,2 s |
| `npm test -- --grep 'polling\|lightbox\|modal\|real locally' --reporter=line` | PASS, 12/12, 7,9 s après dernière correction ; cas inclus dans la passe finale de 60 tests |
| `git diff --check` | PASS |
| `node --check scripts/verify-storage.mjs` / compilation Python | PASS |
| `npm audit --omit=dev` et `npm audit` | FAIL résiduel documenté : 4 entrées modérées, chaîne unique transitive hors bundle navigateur, aucun high/critical |
| `node scripts/verify-storage.mjs --test-project` | NON TESTÉ distant, arrêt local code 2 faute d'URL/clé |
| Safari iPhone / Chrome Android physiques, HEIC réel, réseau mobile | NON TESTÉ |
| En-têtes/HTTPS/Storage/Auth/quota du site déployé | NON TESTÉ |

Les erreurs détectées pendant la QA (titres, landmark, focus et destination publique conservée au réessai après choix privé) ont été corrigées ; le dernier défaut a été reproduit par un test FAIL avant correction puis PASS sur les trois projets. Le problème initial de lancement WebKit provenait des variables GTK/GIO Snap, neutralisées seulement pour son processus. Les tests ne désactivent aucune protection du produit.

## 5. SÉCURITÉ : RLS / Storage / Admin / 2 votes

Aucune clé privée ni credential admin présent. RLS/permissions testées sur PostgreSQL, y compris accès direct, privés, attente, masqués, admin non autorisé, mutations illégales et concurrence des votes. Deux identifiants de navigateur, jamais deux personnes certifiées. NSFW est préventif et falsifiable côté client. URLs déjà délivrées valables jusqu'à une heure après masquage. Le script A–F doit prouver les signatures et uploads réels ; une simulation SQL ne le fait pas.

CSP sans unsafe-inline/unsafe-eval, scripts/polices locaux, pas d'HTML utilisateur injecté, nom malveillant testé comme texte, validation de fichier et UUID neuf à chaque tentative. Les garde-fous par UUID n'empêchent pas un abus distribué de Storage ; surveiller les quotas. Le script vendor confirme l'absence des modules concernés par [l'avis sprintf-js](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) dans le navigateur. Ne pas forcer un audit fix qui casserait la compatibilité NSFW.

## 6. CONFIGURATIONS DISTANTES NON APPLIQUÉES

Projet Supabase et migrations, bucket/policies, comptes Auth, liste admin_users, désactivation des inscriptions, vérification Storage, plan B éventuel, hébergement, domaine, quota/offre et QR. Aucun achat, push Git distant, suppression distante, publication ni migration distante effectué. Le build local montre un état « album se prépare » tant que l'URL et la clé publique manquent.

## 7. ACTIONS HUMAINES INDISPENSABLES (numérotées, max 10)

1. Créer le projet de test et exécuter 0001→0003 dans SQL Editor, puis vérifier Private/JPEG/3 Mo dans Storage.
2. Copier URL/clé publique dans config ; lancer le script `--test-project`, exiger A–E PASS et valider les chemins privés connus F.
3. Créer les comptes dans Authentication, fermer les inscriptions, insérer les UUID dans admin_users, tester autorisé/refusé.
4. Usage/Billing : mesurer 20–50 vraies photos, valider la capacité et toute dépense vous-même.
5. Renseigner les vrais prénoms/photo, lieu facultatif ; vérifier le cadrage à 360 px.
6. Construire et publier seulement dist sur l'hébergement choisi, vérifier HTTPS/en-têtes/URL et scanner le QR imprimé.
7. Faire la recette iPhone/Android et confidentialité réelle avant le 25, puis remettre GUIDE_TEMOIN et les accès au témoin.
8. Geler les fonctions le 25 ; corrections critiques jusqu'au 27 ; vérification de disponibilité avant le départ du 29.

Chaque action avec où cliquer, quoi copier, résultat attendu et vérification est détaillée dans `ACTIONS_HUMAINES.md` (8 actions) et `README_DEPLOIEMENT.md`. Ces actions ne nécessitent aucune nouvelle conception technique ordinaire.

## 8. BLOQUANTS AVANT LE 25 OCTOBRE

**Pas de feu vert production sans** accès Supabase configuré, dépôt A réussi (ou plan B réellement validé), confidentialité Storage/API prouvée, administrateurs opérationnels, quota suffisant et recette sur vrais appareils. URL définitive/QR et disponibilité du projet à valider. Prénoms/photo souhaitables mais fallback fonctionnel, aucun blocage technique pour ces éléments.

## 9. LIMITATIONS ET FONCTIONS REPORTÉES

Pas de nouvelle fonction ajoutée : pas de likes, ZIP, compte invité, reconnaissance faciale, websocket, masque global, traitement serveur IA ou migration R2. Pas de conversion HEIC lourde ni conservation des originaux. Photos compressées et métadonnées retirées. Pas de garantie de détection NSFW, de révocation instantanée des URL ni d'identité individuelle derrière les UUID.

NON TESTÉ : téléphones physiques, HEIC natif, lecteur d'écran, 48 Mpx sur téléphone, charge réseau mobile réelle, Supabase distant et hébergement. Le nettoyage automatique des orphelins est hors écran MVP ; procédure manuelle prête. Une suppression dont Storage.remove échoue exige un nettoyage via la liste des lignes deleted, pas admin_orphans. Aucun bug bloquant connu dans les parcours locaux testés ; les blocages restants sont la mise en service et la recette réelle. Audit npm résiduel explicite.

## 10. COMMITS ET ÉTAT GIT FINAL

Branche locale `feat/mariage-photos-mvp`, Git initialisé dans le kit sans écraser de dépôt existant.

- `9e5a7d5` — `chore: preserve original wedding V3 kit`
- `c92efb6` — `feat: implement wedding gallery uploads and secure moderation client`
- `1eaee4a` — `test: verify browser flows SQL permissions and local security headers`
- `3e463c8` — `docs: deliver wedding deployment checklist and handoff`
- `6f4641d` — `fix: honor selected audience when retrying failed uploads`
- Commit de clôture : `docs: record final 60-test verification` (retrouver son identifiant avec `git log -1 --oneline`).

Aucun remote configuré/push effectué. Les sorties régénérables sont ignorées. Vérifier `git status --short` : attendu vide après le commit documentaire.

**Mission de Claude : audit ciblé uniquement**, sans changer la stack ni refaire la direction artistique. Priorités : fuite privée, client Auth invité/admin, API Storage réel, perte/duplication d'envoi, RLS/RPC, nettoyage après suppression partielle. Relancer les tests pertinents après correction ; conserver D01–D23 et le gel de périmètre.
