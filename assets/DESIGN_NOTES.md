# Direction graphique — Thomas & Aziliz

La mission corrective du 11 octobre 2026 remplace la direction sombre des trois maquettes V3. Palette : ivoire `#f8f5ee`, papier clair `#fffcf7`, sauge `#58654b`, détails champagne. Typographies locales existantes : Cormorant Garamond et Jost.

La maquette claire mentionnée dans le texte de la mission n’est pas présente parmi les pièces jointes accessibles : seuls les sept originaux et la mission écrite sont disponibles. La composition applique donc cette description ; aucune fidélité exacte à une image non consultée n’est revendiquée.

## Accueil et galerie

- Identité Thomas & Aziliz, date réelle, titre « Les photos de notre mariage ».
- Portrait du jardin dans un cadre en arche, illustration botanique SVG et texture CSS légère. Aucun traitement génératif des photographies.
- Bouton principal « PARTAGER MES PHOTOS », secondaire « VOIR LA GALERIE ». Sur mobile, les actions précèdent le portrait ; le bouton flottant existant accompagne la consultation de la galerie.
- Sept Polaroids, défilant horizontalement sur mobile avec une zone accessible au clavier. Cette bande de présentation est séparée du conteneur `#gallery` et ne crée aucune entrée Supabase.
- Navigation : Accueil, Partager des photos, Galerie. L’administration reste sur son URL dédiée.
- Galerie des invités : données, signatures, lightbox, téléchargement, signalement et rafraîchissement existants conservés.

## Partage et administration

Les destinations sont affichées avant la sélection. Les radios, identifiants des contrôles, validations et mécanismes d’envoi restent les mêmes. Les cartes sélectionnées sont sauge clair, les conseils sur papier champagne. L’administration reprend les mêmes couleurs avec des actions et onglets de 44 px minimum.

## Photographies

Les sept fichiers `assets/couple/*.jpg` sont des copies binaires des JPEG fournis, sans recompression, métadonnées modifiées ni retouche. Les noms sont descriptifs. Seul le cadrage d’affichage CSS varie selon le support ; les visages et les arrière-plans ne sont pas reconstruits. Le portrait principal pèse 297 465 octets ; les sept originaux totalisent 1 404 642 octets. Les Polaroids sont chargés paresseusement, les dimensions explicites réservent leur espace et le portrait principal est prioritaire.

Ces sept photos de présentation sont des ressources statiques publiques du site. Elles sont indépendantes des albums privés, dont l’accès Supabase reste inchangé.

## Périmètre

Aucune nouvelle dépendance, aucun service tiers ajouté, aucune migration et aucun déploiement dans cette mission. Les données de test restent dans les mocks ; elles ne sont pas copiées dans `dist/`. Le site de mariage reste volontairement non indexable (métadonnées, robots et en-têtes existants).

Résultats et captures : [revue de la refonte](../qa/DESIGN_REVIEW.md).
