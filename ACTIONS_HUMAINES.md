# Actions humaines — maximum 8, avant le 25 octobre 2026

> **Galerie/lightbox — 11 octobre 2026.** Après cette correction, rebuilder puis republier uniquement `dist/` (aucun déploiement effectué ici). Vérifier surtout le bas des photos au-dessus de Télécharger/Signaler sur votre Chrome, puis sur iPhone Safari : barre d’adresse, rotation, pincement et retour à la galerie. Procédure et mesures : [rapport galerie/lightbox](qa/GALERIE_LIGHTBOX.md).

> **Mise à jour graphique du 11 octobre 2026.** L’identité Thomas & Aziliz et les sept originaux sont maintenant intégrés : l’action 5 ci-dessous est réalisée côté développement. Examiner les [captures 390/768/1440 px](qa/DESIGN_REVIEW.md), puis valider la refonte avant tout déploiement. La maquette claire citée dans la mission n’était pas jointe ; la direction écrite a été appliquée. La configuration Supabase publique existe déjà : les mentions historiques « absente » ci-dessous ne décrivent plus `config.js`. Cette mission ne réévalue pas l’état des services distants ; conserver la recette réelle et le contrôle iPhone/Android avant le 25 octobre.

> **Ordre recommandé et regroupé en 4 séances : voir `GUIDE_PRODUCTION.md`.** Ce fichier reste la liste de référence.

Le développement local est livré ; aucune configuration distante ni dépense n'a été faite. Références détaillées : README_DEPLOIEMENT. Le kit fait foi pour le périmètre.

1. **D'ici le 15 octobre — Supabase de test.** Dashboard > New project (Europe), puis SQL Editor : copier/exécuter `0001`, `0002`, `0003` dans cet ordre. Dans Storage > photos : vérifier Private/JPEG/3 Mo. Copier Project URL + clé publique dans `config.js`. Attendu : migrations sans erreur et aucune clé privée dans le navigateur.
2. **Immédiatement après — vérification n°1.** Terminal du kit : `npm ci`, puis `node scripts/verify-storage.mjs --test-project` sur projet vide. Attendu A–E PASS et code retour 0 ; conserver la sortie. Si A échoue RLS, suivre le plan B du README Supabase avec validation réelle. Si B ou E donne accès, ne pas mettre en ligne.
3. **D'ici le 18 — administrateurs.** Authentication > Users > Add user : créer vos comptes réels et celui du témoin, Auto Confirm. Providers : désactiver les inscriptions publiques. SQL Editor : copier l'INSERT admin_users du README et remplacer chaque email. Vérifier la connexion à `/admin.html`, puis le refus d'un compte non autorisé.
4. **D'ici le 18 — capacité.** Organization > Usage/Billing : vérifier l'offre et les quotas. Avec `python3 scripts/estimate_storage.py --assume-full-kb 350`, hypothèses non mesurées : 1 300 / 3 250 / 5 200 / 7 800 photos = **0,51 / 1,26 / 2,02 / 3,04 Go** ; trafic 6 visites = **2,8 Go**, prévoir x2. Le polling augmente fortement ce total : `--views 120` → **24,6 Go** avant marge (cache à mesurer). Remplacer par 20–50 vraies photos. Le kit recommande Pro pour le mois d'octobre ; [tarifs officiels](https://supabase.com/pricing), actuellement dès 25 USD/mois, à confirmer dans votre compte. **Vous validez seul toute dépense.** Ne pas diffuser le QR si la capacité choisie est insuffisante.
5. **D'ici le 20 — identité visuelle.** Éditer `NAMES` dans `config.js`, fournir la vraie photo locale et renseigner `COUPLE_PHOTO`, lieu facultatif. Vérifier cadrage à 360 px. Sans ces éléments, le fallback neutre est utilisable ; aucun faux prénom ou couple n'est publié.
6. **D'ici le 22 — URL définitive et préproduction.** Lancer `npm run vendor && npm run build`. Hébergeur choisi > nouveau site statique : publier uniquement `dist/`, HTTPS. Vérifier `_headers`, noindex, robots et URL admin ; scanner l'épreuve du QR vers cette URL (avec `?k=` si utilisé). La procédure détaillée indique les paramètres Git si préférés.
7. **Au plus tard le 24 — recette sur appareils et service réels.** Exécuter les sept étapes express du README sur un iPhone et un Android. Pour chaque privé/en attente/masqué, recopier les chemins depuis SQL Editor et exécuter le contrôle F du script. Attendu : aucun accès anonyme, deux signalements retirent, admin et réessais fonctionnent. Compléter CHECKLIST_TESTS (appareil, date, PASS/FAIL), sans assimiler les mocks à cette recette.
8. **Le 25 — feu vert et transmission.** Vérifier que les bloquants ci-dessous sont levés, remettre GUIDE_TEMOIN et identifiants par votre canal privé habituel. Geler les fonctionnalités ; 26–27 réservés aux corrections critiques. Vérifier à nouveau le lien et l'état Supabase avant le départ du 29. Décider de la conservation/export des fichiers après le mariage hors périmètre de ce MVP.

## BLOQUANTS AVANT LE 25 OCTOBRE

- URL/clé publique Supabase absentes ; migrations, Storage et Auth distants non appliqués/non testés.
- Vérification A–E réelle et confidentialité des chemins connus F non exécutées. Plan B non validé si A échoue.
- Compte admin/témoin réel non validé et recette iPhone/Android non réalisée.
- Quotas/offre non décidés, URL HTTPS définitive et QR non validés.

Les prénoms/photo sont souhaitables mais le fallback évite d'en faire un blocage technique. Aucun développement secondaire n'est nécessaire pour terminer la recette.
