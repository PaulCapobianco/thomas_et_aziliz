# Architecture livrée — 11 octobre 2026

## Audit initial

Le dossier fourni est `KIT_CODEX_MARIAGE_V3/`, initialement sans Git, README général, package.json ni framework. Le kit entier a été sauvegardé dans le commit `9e5a7d5`, branche `feat/mariage-photos-mvp`. Aucun accès distant, vraie photo, prénom ou lieu n'était fourni. L'ancien index utilisait Storage.list, des URL publiques, une pagination offset et des CDN ; ces accès ont été remplacés conformément aux décisions V3. Les trois migrations restent **inchangées**.

## Trois écrans, sans framework

- `index.html` : accueil/galerie `#galerie` et partage `#partager`. Le paramètre `?k=` est conservé et mémorisé si possible.
- `admin.html` : connexion Supabase Auth et contrôle d'urgence. Autorisation effective par les RPC SQL et `admin_users`.
- `app.css` + tokens du kit : mobile-first, ivoire/anthracite/cuivre, polices locales Cormorant Garamond et Jost. Aucun faux couple ni contenu de galerie fictif. La page 404 est uniquement la réponse d'erreur de l'hébergement.
- `config.js` : constantes publiques historiques en tête, puis lieu, photo réelle et drapeau NSFW. Aucun identifiant personnel inventé.
- `app.js` : galerie, pagination keyset, lightbox, clavier, swipe, téléchargement et signalements.
- `uploads.js` : validation, décodage orienté, SHA-256 original, NSFW, JPEG 1600/0,8 et 400/0,7, envoi séquentiel, reprise et progression du lot.
- `shared.js` : clients, identité navigateur, RPC, signature, erreurs et dialogs accessibles.
- `admin.js` : accès, listes, modération, pause, libération contrôlée et suppression des fichiers best effort.

## Données et sécurité

La base est la source de vérité. La galerie appelle exclusivement `gallery_page`, puis signe les miniatures par lots de 48 pendant 3600 secondes. Les grands formats sont signés à l'ouverture. Aucun `getPublicUrl` ou `storage.list` dans le site. Le script de vérification distant utilise `list` volontairement pour tester la policy.

Une photo suit : validation → décodage → empreinte originale → doublons → NSFW public → réencodage JPEG → UUID neuf → miniature → grand format → `register_photo`. La base choisit le statut. Une interruption produit éventuellement des objets orphelins, jamais une confirmation de publication incomplète. Une réponse de finalisation perdue est résolue par `check_duplicates` au réessai ; le message peut alors indiquer « déjà envoyée ».

Le client invité désactive la persistance et le rafraîchissement Auth. Il ne récupère jamais la session admin. Le client admin conserve sa session **dans sessionStorage**, avec repli mémoire, pour permettre le rechargement du même onglet sans token dans localStorage. Supabase gère ses tokens ; un XSS pourrait toutefois lire sessionStorage, d'où absence de HTML injecté, CSP et scripts locaux. Aucun cookie d'authentification applicatif : pas de formulaire de mutation par cookie nécessitant un jeton CSRF.

Un seul bucket privé `photos`. Les invités n'écrivent que des objets JPEG aux chemins valides ; toutes les mutations de tables sont des RPC. Masquage après deux UUID de navigateur distincts, verrou SQL ; restaurer efface les anciens votes. En pause, les nouvelles publications publiques attendent, les privés et la galerie existante restent disponibles.

Les anciennes URL signées restent valables jusqu'à une heure après masquage. `?k=`, noindex et NSFW côté navigateur ne sont pas des contrôles de confidentialité. Les garde-fous par UUID n'empêchent pas un client malveillant de changer d'identité ou remplir le stockage. La mise en service exige les tests réels du README Supabase.

## Fiabilité et performance

Une seule photo en traitement, deux JPEG maximum, canvas et ImageBitmap libérés, aperçus petits et URL locales révoquées. Source limitée à 30 Mo et 60 Mpx pour borner l'usage courant ; le décodage d'une image démesurée peut néanmoins allouer de la mémoire avant le contrôle de dimensions. HEIC dépend du navigateur, avec erreur explicite et suggestion JPEG. Aucune conversion HEIC lourde.

NSFWJS/TensorFlow et MobileNetV2 auto-hébergés, chargés uniquement au premier envoi public. Timeout chargement 15 s, inférence 8 s ; indisponibilité → attente `model_unavailable`. Aucun score ni image journalisé. Sexy seul ne bloque pas. Les probabilités malformées ne valent pas un feu vert.

Le polling visible est de 60 s. Le rafraîchissement relit la fenêtre déjà chargée, fusionne les ID et écarte les photos retirées même après la première page. Pas de websocket. Re-signature au rafraîchissement et au retour visible après 30 min. Cette relecture coûte davantage si beaucoup de pages sont ouvertes : tenir compte du polling dans l'estimation du trafic.

Le site statique s'assemble dans `dist/` par copie d'une liste autorisée. Aucun SQL, test, fixture, maquette, dépendance Node ou document interne n'est publié. JavaScript applicatif sans build obligatoire ; esbuild sert uniquement à préparer le module NSFW et exclut les modèles inutiles. Polices (~35 Ko), SDK Supabase (~216 Ko), NSFW/TensorFlow (~1,1 Mo) + modèle (~2,6 Mo) non compressés ; les deux derniers sont différés. Aucun analytics ni CDN invité.

## Qualité et limites de preuve

Playwright injecte de faux clients/modèles via `addInitScript`, hors produit. PostgreSQL 16 vérifie réellement les droits SQL avec le stub du kit. Le vrai modèle est également chargé localement sur une image synthétique : cela vérifie l'intégration, pas la qualité de détection sur un mariage. Le serveur de recette applique `_headers` pour tester la CSP. Ces preuves ne remplacent ni Supabase Storage/Auth réels, ni Safari iPhone/Chrome Android sur appareils réels.

Références consultées : [Storage/RLS Supabase](https://supabase.com/docs/guides/storage/security/access-control), [signature multiple](https://supabase.com/docs/reference/javascript/storage-from-createsignedurls), [NSFWJS officiel](https://github.com/infinitered/nsfwjs).
