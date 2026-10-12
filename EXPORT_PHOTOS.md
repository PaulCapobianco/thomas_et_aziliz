# Exporter et sauvegarder les photos

Deux outils, aucun nouveau droit : ni migration SQL, ni clé `service_role`, ni modification des règles d'accès Supabase.
Seuls les **administrateurs** (comptes de `public.admin_users`) peuvent lister ou télécharger les photos, y compris le dossier privé.

> **Rappel** : les photos du dossier « Uniquement aux mariés » sont privées pour les invités, mais **tout administrateur y a accès**, dans l'application comme dans ces exports. Stockez les archives sur un disque que vous maîtrisez.

## 1. Export depuis l'administration (navigateur)
`admin.html` > connexion > onglet **Export**.
- Deux dossiers : **Galerie commune** (`public`) et **Uniquement aux mariés** (`maries`), avec le nombre de photos à exporter et le détail par statut.
- Statuts : *Publiées* et *En attente* cochés par défaut ; *Masquées* à cocher pour les inclure.
- Bouton **Exporter** par dossier. Les photos sont lues **une à une** en grande définition (≤ 3000 px) avec l'URL signée de l'administrateur (la même fonction que « Télécharger » dans l'aperçu), puis rangées dans des archives ZIP **sans compression** (les JPEG ne se compressent pas) :
  - lots de **100 photos au plus ou environ 150 Mo**, au premier des deux seuils ;
  - noms `mariage-public-lot-01.zip`, `mariage-maries-lot-02.zip`… ;
  - dans chaque archive : `0001_2026-10-31T1432_1a2b3c4d.jpg` (numéro d'ordre chronologique, date d'envoi **en UTC**, 8 premiers caractères de l'identifiant) et `index.csv`.
- `index.csv` : `fichier, identifiant, date_envoi, audience, statut, raison_attente, taille_octets, sha256`. Aucune autre donnée personnelle.
- Progression « Lot 2 sur 7 : 43 sur 100 », bouton **Annuler** (le lot en cours est enregistré avec les photos déjà lues), 3 essais automatiques par photo, puis rapport : les photos en échec n'arrêtent pas le lot ; **Réessayer les échecs** crée une archive supplémentaire (numéro de lot suivant) avec les numéros d'ordre d'origine.
- Contrôle d'intégrité à la fin : **« Export complet : N photos sur N. »** ou la liste des écarts (manquantes, ajoutées ou retirées pendant l'export), comparé à la base pour le dossier et les statuts choisis.
- La page ne se rafraîchit pas seule pendant un export ; gardez-la ouverte. Sur téléphone un avertissement conseille d'utiliser un ordinateur (non bloquant).
- Le navigateur télécharge plusieurs fichiers : acceptez « télécharger plusieurs fichiers » si le navigateur le demande.
- Aucune bibliothèque : le format ZIP « stocké » est écrit par `export-zip.js` (CRC-32 et SHA-256 natifs). Rien n'est ajouté à `vendor/`, la CSP est inchangée.

Vérifier une archive : `unzip -t mariage-public-lot-01.zip`, puis `sha256sum` d'un fichier à comparer avec `index.csv`.

## 2. Sauvegarde complète en ligne de commande (`scripts/export-photos.mjs`)
Node ≥ 18 et les dépendances du projet (`npm ci`). Télécharge, par dossier, les photos **full et miniatures**.
```bash
export SUPABASE_URL=https://VOTRE-PROJET.supabase.co
export SUPABASE_PUBLISHABLE_KEY=sb_publishable_...        # clé PUBLIQUE uniquement
node scripts/export-photos.mjs --out ~/sauvegarde-mariage
# options : --folders public,maries   --status published,pending_review,hidden   --no-thumbs
```
- Le script demande l'**e-mail** et le **mot de passe** administrateur ; ils ne sont écrits dans aucun fichier. (Pour une exécution automatisée seulement : `EXPORT_ADMIN_EMAIL` / `EXPORT_ADMIN_PASSWORD`.) Un compte non administrateur est refusé ; une clé secrète (`sb_secret_…` / `service_role`) est refusée avant toute requête.
- Arborescence : `public/full`, `public/thumbs`, `public/index.csv`, idem `maries/`. Noms de fichiers : `AAAAMMJJTHHMMSSZ_<uuid>.jpg` (stables : un nom ne change pas si une photo est supprimée).
- `index.csv` : fichier, miniature, identifiant, date, audience, statut, raison, taille et SHA-256 du fichier full, taille et SHA-256 de la miniature.
- **Relançable** : un fichier déjà présent dont la taille correspond à celle du serveur n'est pas retéléchargé ; un fichier tronqué est retéléchargé.
- Vérifications : taille reçue = taille annoncée, signature JPEG, puis **relecture de chaque fichier sur le disque** (taille + SHA-256 comparés à l'index) et comparaison avec la base. Code de sortie 1 si un écart subsiste.
- Ne le lancez pas sur le projet hébergé sans en avoir décidé : il lit et télécharge réellement toutes les photos (trafic sortant Supabase).

## 3. Limites connues
- Le SHA-256 est celui du fichier **tel que stocké** (≤ 3000 px recompressé par l'application), pas de l'original de l'invité, qui n'est pas conservé.
- Les liens signés valent 1 h : un export très long renouvelle un lien par photo, donc sans conséquence.
- Pas de ZIP64 : un lot reste très en dessous de 4 Go.
- Non testé sur le projet hébergé ni sur un vrai téléphone (voir CHECKLIST_TESTS.md).
