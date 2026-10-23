# Pages légales — `/confidentialite` et `/conditions-utilisation`

Deux pages statiques publiques (aucune connexion, aucun script externe) : `confidentialite.html` et `conditions-utilisation.html`, avec `legal.css` et `confidentialite.js` (remplit l'adresse de contact). Elles se renvoient l'une à l'autre.
URLs prévues : https://thomas-aziliz-mariage.pages.dev/confidentialite et https://thomas-aziliz-mariage.pages.dev/conditions-utilisation (Cloudflare Pages sert `confidentialite.html` sans extension ; `/confidentialite.html` et `/confidentialite/` redirigent en 308 vers l'adresse propre). Liens discrets « Confidentialité » et « Conditions d'utilisation » dans le pied de page de l'accueil.

## À faire avant la mise en ligne (rien n'est inventé dans la page)
1. **Adresse de contact** : renseigner `PRIVACY_EMAIL` dans `config.js` (vide par défaut). Tant qu'elle est vide, la page affiche « l'adresse de contact sera indiquée ici par les mariés » et `npm run build` affiche un avertissement.
2. **Relire les points listés dans le bilan de livraison** (durée de conservation, formulations à valider).
3. **Quand la sauvegarde Google Drive sera réellement activée** (GUIDE_DRIVE.md, étape D-4) : dans la section `#google-drive`, remplacer le paragraphe `data-drive-status="inactive"` par un texte « La sauvegarde est activée depuis le … », passer l'attribut à `active`, et adapter l'introduction (« sera activée » → « est activée »). Le test `tests/privacy.spec.js` vérifie que la page ne prétend jamais que la sauvegarde est active tant que l'attribut vaut `inactive` : mettre ce test à jour en même temps.
4. Mettre à jour la ligne « Dernière mise à jour » à chaque modification de fond.

## Ce que la page décrit (sources dans le code)
Photos (JPEG ≤ 3000 px, métadonnées non conservées) · destination choisie · date/statut/empreinte SHA-256 · identifiant aléatoire de navigateur (`localStorage wk_uid`) · signalements (motif, commentaire ≤ 500, identifiant de navigateur) et décisions de modération · contrôle NSFW dans le navigateur (seul le verdict part) · paramètre `?k=` mémorisé (`localStorage wk`) · comptes administrateurs Supabase Auth · pas de cookie, pas d'analytics, pas de publicité.
