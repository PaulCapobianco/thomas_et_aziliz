# Signalement des photos : règle, migration, liens signés (11 octobre 2026)

## Règle
**Un seul signalement valide masque la photo publique**, côté serveur (`report_photo`, migration `0004_report_first_hides.sql`), dans la même transaction que l'enregistrement du signalement (verrou de la ligne de la photo) : statut `hidden`, raison `reports`. La photo et ses deux fichiers sont conservés ; rien n'est supprimé automatiquement.
- **Motif obligatoire** : `sexual` (contenu sexuel, nudité ou sextoy), `violence`, `privacy` (vie privée / droit à l'image), `inappropriate`, `other`. « Autre raison » exige une description de 3 à 500 caractères ; un commentaire facultatif (≤ 500) est possible pour les autres. Tout est revalidé côté serveur (erreur 22023 sinon).
- **Invité** : fenêtre « Pourquoi signalez-vous cette photo ? », bouton « Envoyer le signalement » inactif tant que le motif (et la description pour « Autre ») manque. Après réussite : « Merci pour votre signalement. Cette photo a été retirée temporairement de la galerie et sera examinée par les administrateurs. » Le motif et le commentaire ne sont jamais montrés aux invités.
- **Administrateur** (onglet « Signalées (n) ») : miniature, dates, motifs, commentaires, total et signalements à examiner, statut, dernière décision. **Restaurer** (la photo revient ; les signalements sont conservés mais marqués résolus), **Maintenir masquée** (reste masquée, signalements résolus), **Supprimer** (confirmation, mécanisme existant). Sélection multiple avec la barre d'actions. Chaque décision est tracée dans `photo_moderation`.
- **Après restauration** : les anciens signalements ne remasquent jamais la photo (aucun comptage) ; un **nouveau** signalement valide la masque de nouveau.

## Protection contre les abus (invités anonymes : l'identifiant de navigateur n'est PAS une identité forte)
- un signalement **ouvert** par navigateur et par photo ; au plus 3 au total pour une même photo et un même navigateur ;
- 5 signalements par 10 minutes et par navigateur ;
- **frein global** : au plus 12 photos différentes signalées par tranche de 10 minutes (réponse `rate_limited`) ; sans lui, un script générant des identifiants pourrait vider la galerie, puisqu'un seul signalement suffit. Limite résiduelle : un script peut encore masquer jusqu'à 12 photos par 10 minutes ; l'admin les restaure en lot (onglet « Signalées », « Restaurer (n) ») ;
- les invités n'ont aucun droit direct sur les tables (`photos`, `photo_reports`, `photo_moderation` illisibles et non modifiables) ; les fonctions d'administration refusent anonymes et comptes non admin (42501) ; un signalement n'agit que sur une photo publique publiée ou déjà masquée par un signalement (pas sur une photo privée, en attente, masquée par un admin ou supprimée).

## Liens signés (Supabase Storage) — ce que le masquage fait et ne fait pas
- La photo disparaît de `gallery_page` et de la lecture directe de la table (RLS : seules les photos publiées publiques sont lisibles).
- **Aucun nouveau lien signé** (miniature, grande photo, téléchargement) n'est délivré : la signature exige le droit de lecture Storage, qui dépend du statut `published` (`object_is_public`). Prouvé sur la pile réelle (URL directes `/object/...`, `/object/public`, `/object/sign` sans jeton refusées).
- **Un lien déjà délivré reste utilisable jusqu'à son expiration** : 3600 s au plus (durée choisie par l'application). Le masquage ne révoque pas les liens existants ; seule la suppression des fichiers (« Supprimer ») les rend inopérants.
- Côté application : l'invité qui signale voit la photo quitter la grille immédiatement et la liste est relue ; les autres invités la voient disparaître au rafraîchissement suivant (≤ 60 s) ; une lightbox ouverte se ferme avec « Cette photo n'est plus disponible » ; les liens de miniatures déjà affichés ne sont conservés (45 min) que pour les photos encore listées.
- Une révocation immédiate demanderait une autre architecture (lecture des photos par un Worker qui vérifie le statut à chaque requête, par exemple avec R2) : étude séparée dans `PLAN_R2.md`, non faite ici.

## Migration (à appliquer par vous, jamais automatiquement)
1. Sauvegarde non nécessaire (aucune donnée supprimée), mais exécutez dans l'ordre 0001-0003 (déjà faites), puis **`supabase/migrations/0004_report_first_hides.sql`** dans le SQL Editor : incrémentale, rejouable, compatible avec les signalements existants (anciens motifs `embarrassing` / `child` / `other` conservés et lisibles ; les photos déjà masquées par l'ancienne règle apparaissent dans « Signalées »).
2. **Publiez ensuite le site** (`npm run build`, `npm run deploy`) : l'ancien formulaire n'enverrait plus un motif valide. La fonction `report_photo(uuid, uuid, text)` est remplacée par `report_photo(uuid, uuid, text, text)` ; `admin_list_photos` change de colonnes (même migration).
3. Vérification : `node scripts/hosted-check.mjs --hosted` (section 4 adaptée) ou un signalement de test depuis le site, puis restauration dans l'administration.
