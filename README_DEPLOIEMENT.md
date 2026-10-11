# Mise en service — à terminer avant le 25 octobre 2026

État livré : site fonctionnel localement contre des mocks, SQL testé sur PostgreSQL local. **Supabase réel et hébergement : NON TESTÉ, non déployé.** Le gel des fonctions est prévu le 25, corrections critiques jusqu'au 27, départ le 29, mariage le 31. Lire la recette express en fin de document.

## 1. Préparer un projet Supabase de test

Dans le Dashboard Supabase, **New project**, choisir une région européenne, conserver le mot de passe dans votre gestionnaire de mots de passe. Le choix d'offre vous appartient ; aucune souscription n'a été faite. Utiliser un projet vide pour la première vérification, sans photos réelles sensibles.

Dans **SQL Editor > New query**, copier puis exécuter successivement :

1. `supabase/migrations/0001_schema.sql`
2. `supabase/migrations/0002_functions.sql`
3. `supabase/migrations/0003_rls_storage.sql`

Attendu : succès sans erreur. Dans **Storage > photos**, vérifier **Private**, JPEG uniquement, taille maximale **3 145 728 octets**. Ne jamais exécuter `supabase/tests/00_stub_supabase.sql` ou `run_local.sh` sur le projet distant. Aucune migration n'a été appliquée par l'agent. Si un bucket existant contient déjà des photos ou d'anciennes policies, faire auditer les policies avant de rejouer : les règles permissives anciennes ne doivent pas ouvrir le bucket.

Dans **Project Settings > API / API Keys**, copier l'URL du projet et la clé **anon / publishable** dans `config.js`, constantes `SUPABASE_URL` et `SUPABASE_KEY`. Ne copier ni `service_role`, ni `sb_secret_*`, ni mot de passe. La clé publique est faite pour le navigateur ; les permissions reposent sur RLS.

## 2. Vérification n°1 — obligatoire avant la recette de l'application

Depuis le dossier du kit après `npm ci`, lancer sur ce **projet de test vide** :

```bash
node scripts/verify-storage.mjs --test-project
```

Ce script utilise uniquement le client anonyme, dépose une minuscule miniature JPEG avec un UUID neuf, puis affiche un résultat par contrôle sans journaliser la clé ni d'URL signée. Il ne supprime rien. Équivalent console documenté dans `supabase/README.md` §2.

| Test | Attendu | Si échec |
|---|---|---|
| A dépôt anonyme sans upsert | PASS, chemin du JPEG affiché | Si refus RLS, examiner le plan B fourni ; ne pas ouvrir SELECT pour faire passer l'upload. |
| B signature du fichier non enregistré | PASS, refus effectif (pas une panne réseau) | Une URL accessible est bloquante : ne pas diffuser le QR. |
| C liste Storage sur projet vide | PASS, liste vide | Après publication de photos publiques la liste peut légitimement les contenir ; faire ce contrôle avant les autres envois. |
| D RPC check_duplicates | PASS, tableau vide | Vérifier la migration 0002 et les droits. |
| E RPC admin anonyme | PASS, code 42501 | Si admin_status répond avec des données, arrêter la mise en service. |

Code retour 0 attendu. Archiver la sortie dans votre recette (sans secrets). Si A réussit, l'objet apparaît dans `admin_orphans()` après 30 minutes. Le script ne l'efface pas.

**Plan B seulement si A échoue réellement** : procédure du kit `supabase/README.md` §5, `supabase/optional/plan_b_drop_guest_insert.sql` et Edge Function déjà fournie. Son déploiement et sa validation restent à réaliser avec autorisation. Côté client, remplacer uniquement `uploadObject()` dans `uploads.js` : demander un token à `upload-url`, puis `uploadToSignedUrl`. Ne pas modifier le protocole de finalisation, la lecture ou les RLS. Le plan B n'a pas été activé ni testé ici ; ne pas le déclarer prêt pour production.

## 3. Créer les administrateurs

Dans **Authentication > Users > Add user**, créer chaque compte réel avec un mot de passe distinct, cocher **Auto Confirm User**. Dans **Authentication > Sign In / Providers**, désactiver **Allow new users to sign up**. Garder la connexion par email/mot de passe ; les invités n'ont besoin d'aucun compte, ni d'Anonymous Sign-ins.

Copier dans **SQL Editor**, remplacer l'adresse et exécuter pour chaque organisateur :

```sql
insert into public.admin_users (user_id)
select id from auth.users where email = 'ADRESSE_ADMIN'
on conflict do nothing;
```

Vérifier la présence de l'UUID dans Table Editor > admin_users. Depuis `/admin.html`, se connecter : les compteurs doivent apparaître. Un compte authentifié absent d'admin_users doit recevoir un refus et ne voir aucune miniature privée. Le navigateur invité n'hérite jamais de la session admin. La session admin dure dans l'onglet courant, se recharge dans cet onglet et disparaît à sa fermeture ; se déconnecter après usage d'un appareil partagé.

## 4. Renseigner les éléments du mariage et préparer le site

Dans `config.js` : renseigner `NAMES`, éventuellement `LOCATION`. Ajouter votre vraie `couple.jpg` à la racine puis `COUPLE_PHOTO = "couple.jpg"`. Préférer une image de 1600–2000 px de large, idéalement sous 500 Ko ; vérifier cadrage et lisibilité sur mobile. Sans photo/prénoms, le fond et le texte neutres sont volontaires et fonctionnent. La date réelle est déjà renseignée. `SECRET` peut rester vide ; s'il est défini, QR = `https://DOMAINE/?k=VALEUR#galerie`. Ce paramètre est lisible et ne sécurise rien.

```bash
npm ci
npm run vendor
npm run check
npm run build
```

Attendu : `dist/index.html`, `dist/admin.html`, les JS/CSS, `vendor/`, `fonts/`, `robots.txt`, `_headers`, favicon et 404. La sortie ne doit contenir ni `.git`, ni migrations, ni tests, ni fixtures. Sans URL/clé Supabase, le build avertit et les envois restent désactivés.

Le paquet npm NSFWJS exige une version Node exacte et peut produire un avertissement sous d'autres Node 22 ; le build a été exécuté avec Node 22.21.1. Les versions sont verrouillées. `npm audit --omit=dev` signale une chaîne transitive modérée, détaillée dans CHECKLIST_TESTS ; elle ne figure pas dans le module navigateur livré. Ne pas utiliser audit fix --force.

## 5. Publier après validation

Choisir votre hébergement statique gratuit habituel **Netlify ou Cloudflare Pages**, avec HTTPS. Aucun site distant n'a été créé pour vous.

- Publication manuelle : dans l'interface d'hébergement, créer un site par dépôt de dossier/Direct Upload et envoyer **uniquement `dist/`**, jamais la racine du kit.
- Connexion Git : racine du projet = dossier du kit, commande `npm ci && npm run vendor && npm run build`, sortie **`dist`**. Si Git est initialisé directement ici, la racine est ce dossier. Pas de variables privées nécessaires.
- Pas de rewrite SPA : `#galerie` / `#partager` fonctionnent sans fallback. `/admin.html` est un fichier distinct ; URL inconnue → 404 réelle. Déployer à la racine du domaine, pas dans un sous-dossier.
- Supabase **Authentication > URL Configuration** : Site URL = l'URL HTTPS définitive ; aucun lien magique requis pour cette application.
- `_headers` couvre noindex, no-referrer, CSP, anti-iframe, MIME et cache. La CSP autorise le domaine standard `*.supabase.co`. Si vous choisissez un domaine API personnalisé, ajouter son origine exacte aux directives `connect-src` et `img-src`, pas de wildcard général.

Vérifier dans l'onglet Réseau du navigateur, réponse HTML : `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, CSP et `Cache-Control: no-cache`. Ouvrir `/robots.txt` : `Disallow: /`. Aucun sitemap nécessaire pour cet album non indexable. Ces directives n'empêchent pas un visiteur connaissant l'adresse de consulter les photos publiques.

Le QR imprimé doit viser l'URL HTTPS définitive. Scanner une épreuve imprimée, ouvrir Partager, revenir à la galerie et confirmer la conservation de `?k=` si utilisé. Contrôler le domaine, le certificat et le bouton de téléchargement sans nouvel onglet.

## 6. Vérifier réellement la confidentialité

Après un envoi privé et un envoi public mis en attente, obtenir leurs chemins exacts via SQL Editor (admin), sans les publier :

```sql
select id, audience, status, full_path, thumb_path
from public.photos
order by created_at desc limit 10;
```

Relancer le script avec chaque chemin connu :

```bash
node scripts/verify-storage.mjs --test-project --denied-path=maries/full/UUID.jpg --denied-path=maries/thumbs/UUID.jpg --denied-path=public/full/UUID_EN_ATTENTE.jpg
```

Les UUID ci-dessus sont des emplacements à remplacer. **F doit être PASS pour chaque fichier privé/en attente/masqué**. A dépose encore un petit objet orphelin. C, sur un projet contenant déjà des photos publiées, peut afficher FAIL parce qu'il n'est plus vide : inspecter les résultats sans confondre les fichiers publiés autorisés avec les autres ; refaire la suite A–E sur un projet vide pour sa preuve initiale.

Masquer une photo publique depuis l'admin puis tester une **nouvelle** signature sur son chemin : refus attendu. Une ancienne URL déjà délivrée peut fonctionner pendant une heure, ce n'est pas une révocation immédiate. Tester aussi dans une navigation privée sans session admin et vérifier l'absence des photos privées dans la galerie.

## 7. Quotas et nettoyage

Voir ACTIONS_HUMAINES : 3 250 photos représentent environ **1,26 Go** sous hypothèse 350 Ko + 30 Ko, au-delà de 1 Go. Refaire la mesure avec 20–50 photos réelles via `python3 scripts/estimate_storage.py CHEMIN_PHOTOS`. Ne pas utiliser les fixtures synthétiques pour choisir un forfait. Le polling toutes les 60 s ajoute du trafic ; 120 rechargements de 48 miniatures par invité donnent environ 24,6 Go avant marge, avec ces mêmes hypothèses. La cache réelle influe sur la facturation.

Dans Supabase **Organization > Usage / Billing**, vérifier stockage, trafic caché et non caché, plafond de dépenses et état du projet. La [page officielle des offres](https://supabase.com/pricing) indique Free 1 Go stockage, Pro 100 Go et des quotas de trafic distincts ; vérifier les valeurs au moment de décider. Vous seul validez une offre payante.

Nettoyage manuel, jamais DELETE SQL sur storage.objects :

- Orphelins : connecté en admin dans l'application, appeler `admin_orphans()` depuis un client admin ; examiner les chemins de plus de 30 min, puis supprimer uniquement les objets confirmés via API Storage ou Dashboard Storage.
- Suppression partielle : une photo `deleted` dont `Storage.remove` a échoué reste invisible mais ses fichiers occupent de l'espace. `admin_orphans` ne les liste pas. SQL Editor : `select full_path, thumb_path from public.photos where status = 'deleted';`, puis examiner/supprimer ces objets dans Dashboard Storage. Ne jamais supprimer des chemins encore référencés par une photo conservée.

## Recette express (20–30 minutes, appareils réels)

1. Safari iPhone puis Chrome Android : scanner le QR, envoyer 3 JPEG et une photo iPhone native. Vérifier les aperçus, orientation, état final et galerie.
2. Renvoyer un fichier exact, puis une photo ressemblante différente : seul l'exact est ignoré. Envoyer le même fichier aux mariés : destination indépendante.
3. Photo privée : absente en navigation privée, signature refusée sur les deux chemins connus. Photo suspecte/en attente : même refus.
4. Deux navigateurs : premier signalement garde la photo, second la masque ; le même navigateur ne compte pas deux fois.
5. Admin sur téléphone : masquer/restaurer, pause, nouvel envoi public en attente, privé toujours reçu, reprise puis libération des photos dues à la pause. Examiner individuellement les suspects.
6. Réseau faible/coupé : aucune fausse réussite, réessai disponible, annulation après la photo en cours. Lightbox : swipe, fermer, télécharger, retour focus au clavier sur ordinateur.
7. Contrôler Usage/Billing et les en-têtes HTTPS. Remplir les lignes NON TESTÉ de CHECKLIST_TESTS avec appareil, date et résultat réel. Remettre GUIDE_TEMOIN et le lien admin au témoin avant le 25.
