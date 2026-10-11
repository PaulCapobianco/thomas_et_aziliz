# Décisions préparées (priment sur le cahier des charges V2 en cas de conflit)

Ces décisions lèvent les ambiguïtés du cahier V2 pour que Codex n'ait aucune question à poser.
Ordre de priorité en cas de contradiction : **ce fichier > cahier des charges V2 > maquettes > prompts**.
Codex les recopie dans `DECISIONS.md` ; il ne s'en écarte que si un test réel prouve qu'elles sont fausses (et il l'écrit).
Le périmètre ne change pas : aucune fonctionnalité n'est ajoutée.

## Stockage et sécurité

**D01. Un seul bucket privé `photos`**, chemins `<audience>/<full|thumbs>/<uuid>.jpg` (`audience` = `public` ou `maries`). Pas de bucket public, aucun fichier déplacé.
*Pourquoi :* un seul mécanisme ; retirer une photo = changer son statut en base, plus aucune URL signée n'est délivrée ; les anciens liens ne sont pas permanents. Remplace l'option « bucket public » du §6 du cahier.

**D02. URL signées.** Miniatures : `createSignedUrls(paths, 3600)` par page de 48 (un seul appel). Photo en grand : `createSignedUrl(full_path, 3600)` à l'ouverture du lightbox. Téléchargement : `createSignedUrl(full_path, 3600, { download: 'photo-mariage.jpg' })`. Re-signer au clic sur « Actualiser » et au retour d'onglet après plus de 30 min.
*Limite à afficher honnêtement dans la doc :* une URL déjà délivrée reste valable jusqu'à expiration.

**D03. La base est la source de vérité.** La galerie lit `rpc('gallery_page')` (pagination *keyset* sur `(published_at, id)`), jamais `storage.list()`. La pagination par `offset` du code actuel dupliquerait des photos dès que de nouvelles arrivent en haut (test T17).

**D04. Écritures uniquement par RPC** (`register_photo`, `report_photo`, `admin_*`). Aucune policy INSERT/UPDATE/DELETE sur les tables. Les migrations fournies dans `supabase/migrations/` sont la référence : Codex ne les modifie que si un test le justifie, relance `supabase/tests/run_local.sh` après toute modification, et garde tous les tests PASS.

**D05. Identité navigateur.** `uploader_id` et `reporter_id` = UUID `localStorage['wk_uid']` (repli en mémoire si le stockage est bloqué). Ce n'est pas une identité de personne ; l'interface dit « deux signalements », jamais « deux personnes ».

**D06. Vérification n°1 sur Supabase réel** (`supabase/README.md`, section 2) : test A de dépôt anonyme. Si elle échoue, plan B (Edge Function d'URL signées). Codex prépare le code client pour que passer au plan B ne demande que de changer une fonction `uploadObject()` (isoler l'appel d'upload dans une seule fonction).

## Envoi (écran Partager)

**D07. Protocole d'envoi, dans cet ordre, par photo :** (1) valider type/poids, décoder (`createImageBitmap(file, { imageOrientation: 'from-image' })`, repli `Image`) ; (2) SHA-256 du fichier **d'origine** (`crypto.subtle.digest`) ; (3) doublons du lot, puis `check_duplicates` (par lots de ≤ 200) ; (4) NSFW si destination publique ; (5) produire `full` (1600 px, JPEG 0,8) et `thumb` (400 px, JPEG 0,7) ; (6) `uuid = crypto.randomUUID()` **nouveau à chaque tentative** ; upload `thumbs/` puis `full/` ; (7) `register_photo`. Une photo n'est comptée « envoyée » qu'après la réponse de `register_photo`. Envoi séquentiel (une photo à la fois), libération des canvas et `URL.revokeObjectURL` après chaque photo. Jusqu'à 3 tentatives par fichier avec attente croissante (1 s, 3 s) sur erreur réseau ; un bouton « Annuler » arrête après la photo en cours.
La réencodage par canvas supprime les métadonnées EXIF (dont la position GPS) : c'est un plus pour la vie privée, à mentionner dans le texte d'information (« ce ne sont pas les originaux »).

**D08. NSFWJS.** Auto-hébergé (`scripts/vendor.sh` ; sinon documenter le blocage). Chargé **au premier envoi public**, jamais au chargement de la page. Classification sur le canvas de la **miniature 400 px**, une image à la fois. Constantes en tête de fichier, à ajuster :
```
NSFW_SUSPECT_PORN_HENTAI = 0.60      // Porn + Hentai >= 0.60  => suspect
NSFW_SEXY_STRONG         = 0.85      // Sexy >= 0.85 ET Porn + Hentai >= 0.25 => suspect
NSFW_SEXY_WITH_PORN      = 0.25      // "Sexy" seul ne bloque JAMAIS (robes, dos nus, danse)
NSFW_LOAD_TIMEOUT_MS     = 15000     // dépassé => verdict 'unavailable'
NSFW_CLASSIFY_TIMEOUT_MS = 8000
```
Verdict envoyé à `register_photo` : `clean | suspect | unavailable` (public), `skipped` (privé). Ne journaliser ni probabilités ni images. Les tests injectent un faux modèle (`page.addInitScript`), pas de paramètre d'URL de test en production.
Si le modèle est indisponible (ou si `NSFW_ENABLED = false`, drapeau de repli du §11) : verdict `unavailable` ⇒ la photo passe en `pending_review` (raison `model_unavailable`). L'invité voit « Photo reçue, elle apparaîtra après validation », jamais « vérifiée ».
Libération groupée par l'admin : `admin_release_pending('model_unavailable')`. Les photos `nsfw` se libèrent une par une.

**D09. Restitution à l'invité :** `published` → « Ajoutée à la galerie » ; `pending_review` → « Reçue, elle apparaîtra après validation » ; `duplicate` → « Déjà envoyée, ignorée » ; échec → raison + bouton « Réessayer les échecs ». Récapitulatif : `réussites / doublons ignorés / en attente / échecs`.

**D10. Doublons.** Une photo **masquée** reste un doublon (elle ne ressuscite pas par renvoi). Une photo **supprimée** libère son empreinte. Un fichier présent en public et en « mariés » n'est pas un doublon (destinations indépendantes). Les fichiers d'un envoi interrompu ou d'un doublon détecté tardivement deviennent des orphelins (`admin_orphans`, 30 min).

## Modération et admin

**D11. Signalements.** Motifs : `embarrassing` (« Photo gênante »), `child` (« Photo d'un enfant »), `other` (« Autre ») — pas ceux des maquettes. Un 2ᵉ vote distinct masque (verrou de ligne côté base, testé en concurrence). **Restaurer** une photo efface ses signalements (sinon le même navigateur ne pourrait plus jamais la signaler et d'anciens votes la remasqueraient). Garde-fous : 20 signalements / 10 min / navigateur, 500 envois / 24 h / navigateur.

**D12. Admin.** `admin.html` séparé ; Supabase Auth e-mail + mot de passe, inscriptions publiques désactivées, comptes créés à la main, liste `admin_users` (plusieurs admins possibles : vous + le témoin). Aucun e-mail codé dans le JS. Écrans : *Signalées / En attente / Récentes* (`admin_list_photos`), actions Masquer / Restaurer / Supprimer (confirmation), bouton Pause / Reprise, compteurs et poids total (`admin_status`). Suppression = `admin_set_status(..., 'deleted')` **puis** `storage.remove` des 2 fichiers (best effort). Le bouton « masquer toute la galerie » n'est **pas** développé (§4 : seulement s'il ne compromet pas le planning ; décision : non).

**D13. Pause.** Elle empêche seulement les **nouvelles publications publiques** (statut `pending_review`/`paused`) ; les envois continuent, l'envoi privé aux mariés n'est pas concerné, la galerie existante reste consultable. Reprise = `admin_set_paused(false)` puis, au choix de l'admin, `admin_release_pending('paused')`.

## Interface et hébergement

**D14. Architecture des pages.** `index.html` (vues Accueil/Galerie et Partager par routes `#galerie` et `#partager`, qui conservent `?k=`), `admin.html`, éventuellement un `app.css`/`app.js` partagé. Pas de `partager.html` séparé. Pas de framework.
**D15. `?k=`.** Conservé comme porte d'entrée pratique (mémorisé dans `localStorage['wk']`). Ce n'est pas un contrôle d'accès : la confidentialité repose sur RLS/Storage.
**D16. Fuite de `?k=`.** `<meta name="referrer" content="no-referrer">` sur toutes les pages (sinon `?k=` part dans l'en-tête Referer vers les polices/CDN).
**D17. Polices et bibliothèques auto-hébergées** quand c'est possible (fichiers `.woff2` dans `/fonts`, JS dans `/vendor`) : pas de dépendance à un CDN le soir J, pas de transfert d'adresses IP d'invités à Google. Sinon Google Fonts avec la meta ci-dessus, et le noter.
**D18. Indexation.** `<meta name="robots" content="noindex,nofollow">` sur toutes les pages, `robots.txt` (`Disallow: /`), fichier `_headers` (`X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, `Cache-Control` court sur les HTML) pour Netlify / Cloudflare Pages. Hébergement recommandé : Netlify ou Cloudflare Pages (statique, HTTPS, gratuit) ; la décision finale est humaine.
**D19. Actualisation.** Bouton « Actualiser » + rafraîchissement automatique toutes les 60 s seulement si l'onglet est visible (`visibilitychange`), en re-chargeant la première page et en fusionnant par `id` ; pas de websocket.
**D20. Textes.** Utiliser `assets/COPY_FR.md` ; aucune promesse inexacte (pas de « 100 % privé », pas de « photo vérifiée par IA », pas de « suppression instantanée »).
**D21. Design.** `assets/design_tokens.css` (couleurs mesurées sur les maquettes) et `assets/DESIGN_NOTES.md`. Les éléments des maquettes hors périmètre ne sont pas reproduits (liste dans DESIGN_NOTES).

## Quota et coût

**D22.** Codex ne choisit pas le plan Supabase. Il lance `scripts/estimate_storage.py` sur de vraies photos si on lui en fournit, sinon avec `--assume-full-kb 350`, et écrit le résultat dans `ACTIONS_HUMAINES.md`. Recommandation préparée : prendre l'offre Pro pour le mois d'octobre (voir `ANALYSE_CAHIER_DES_CHARGES.md`, risque R1).

## Livrables ajoutés (documents, pas des fonctionnalités)

**D23. `GUIDE_TEMOIN.md`** : une page, vocabulaire simple, pour la personne qui gérera l'urgence le jour J (se connecter, voir les signalées, masquer, restaurer, pause/reprise, quoi faire si le site ne répond plus).

## Précisions d'implémentation (11 octobre 2026)

Ces précisions complètent D01–D23 sans modifier le périmètre ni les migrations.

- Git initialisé dans le dossier du kit, sauvegarde initiale `9e5a7d5`, branche `feat/mariage-photos-mvp`.
- Supabase JS 2.117.3, TensorFlow JS 4.22.0, NSFWJS 4.4.0, versions exactes et lockfile. Le paquet NSFWJS annonce exactement Node 22.13.0 ; installation avec avertissement EBADENGINE sous 22.21.1, préparation et tests exécutés. Pas de contournement de contrôle de sécurité.
- Le script vendor V3 cherchait un dossier de modèles binaires absent du paquet. Il a été adapté : modèle MobileNetV2 extrait des modules npm en JSON/binaire et bundle `nsfwjs/core` local via esbuild. Aucun CDN, modèle Inception ni framework.
- Polices Fontsource locales, versions 5.2.8 ; sources et licences recopiées avec les assets. Géométrie mobile conservée ; bouton cuivre assombri à #925039 pour le contraste de son texte clair.
- Sources : 30 Mo / 60 Mpx maximum, JPEG/PNG/WebP/HEIC/HEIF décodables. Pas de conversion HEIC supplémentaire. Les canvas 1600/400 et qualités du kit sont conservés ; fond blanc lors de la conversion des images transparentes.
- Client admin indépendant, sessionStorage et repli mémoire ; invité sans session Auth persistante. Aucune donnée admin héritée par l'écran invité.
- La relecture de toutes les pages déjà affichées lors d'une actualisation évite de conserver visuellement une photo masquée hors première page. La pagination de continuation reste keyset. Admin : offset prévu au contrat, sans confusion entre lignes reçues et signatures réussies.
- Supprimer reste une action en deux temps : statut deleted, puis Storage.remove. Si le second échoue, l'interface le dit. Les objets attachés à une ligne deleted ne sont pas listés par admin_orphans ; procédure distincte dans le guide de déploiement.
- Pas de sitemap, JSON-LD événement, Open Graph avec photo personnelle ou canonical public pour cet album volontairement non indexable. Titres/descriptions, noindex, robots et en-têtes présents.
- Aucun forfait choisi, achat ou déploiement. NSFW_ENABLED=false maintient les photos publiques en attente ; aucune nouvelle fonction reportée ne remplace la sécurité.
- Le runner SQL du kit pouvait ignorer une erreur psql au milieu de son pipeline. Arrêt explicite ajouté pour ne pas déclarer PASS sur des assertions interrompues ; SQL de production inchangé.
- Audit npm : quatre entrées modérées proviennent d'une même vulnérabilité sprintf-js/argparse (outillage transitif TensorFlow). Aucun correctif compatible publié au moment de l'exécution ; le vendor vérifie leur exclusion du bundle. Ne pas exécuter npm audit fix --force, qui rétrograderait la pile NSFW.

- Après un échec, « Réessayer les échecs » respecte la destination actuellement sélectionnée. Cette règle évite un envoi public contraire au nouveau choix privé ; test de régression exécuté sur Chromium, mobile émulé et WebKit. Elle ne révoque pas un envoi déjà enregistré antérieurement.
