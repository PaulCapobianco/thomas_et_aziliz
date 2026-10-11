# Album du mariage — 31 octobre 2026

Application statique V3 : galerie/partage dans `index.html`, administration dans `admin.html`, Supabase comme backend. Aucune donnée distante n'a été configurée ou déployée. Ouvrir **README_DEPLOIEMENT.md**, puis **ACTIONS_HUMAINES.md** pour la mise en service.

## Démarrer localement

Node 22, npm, Python 3 ; pour les fixtures : Pillow et numpy. Depuis ce dossier :

```bash
npm ci
npm run vendor
npm run dev
```

Ouvrir http://127.0.0.1:4173. Sans configuration Supabase, le site affiche honnêtement que l'album se prépare et désactive l'envoi. Aucun faux album n'est montré aux invités. Le serveur reste local à la machine.

## Vérifier

```bash
python3 scripts/make_test_images.py
npx playwright install chromium webkit
npm run check
npm test
npm run test:sql
npm audit --omit=dev
npm run build
```

`test:sql` exige Docker et crée puis retire son propre conteneur PostgreSQL 16, sans toucher à une base existante. `npm test` démarre son serveur local automatiquement. Le rapport détaillé est dans `CHECKLIST_TESTS.md`. L'audit npm a un avertissement transitif documenté, sans correctif compatible publié ; les modules concernés sont exclus du bundle navigateur.

`vendor/`, `fonts/`, `fixtures/`, `dist/` et les rapports Playwright sont régénérables et ignorés par Git. La publication porte uniquement sur `dist/`. Ne jamais publier la racine du dépôt ni exécuter le stub SQL sur Supabase.
