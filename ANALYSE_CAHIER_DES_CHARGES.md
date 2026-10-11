# Analyse du cahier des charges V2 (mariage du 31 octobre 2026)

Rédigée le 11 octobre 2026 pour préparer un travail autonome de Codex. Tout ce qui est marqué « testé » l'a été sur un
vrai PostgreSQL 16 local ; rien n'a été testé sur un projet Supabase réel, un navigateur ou un téléphone.

## 1. Verdict

Le cahier est solide : périmètre clair et verrouillé, ordre de priorité des risques, interdiction de prétendre avoir testé ce
qui ne l'a pas été, matrice de décisions. Trois choses empêchaient pourtant Codex de travailler seul :

1. **Des contradictions** ou des choix laissés ouverts (partie 2) qui l'auraient forcé à deviner, ou à vous interrompre.
2. **Des risques techniques non traités** (partie 3), dont deux peuvent faire échouer la soirée : quota Supabase et dépôt anonyme.
3. **Des éléments que seul vous pouvez fournir** (partie 5) : prénoms, photo, e-mail admin, compte Supabase, décision de plan.

J'ai donc tranché les points ouverts (`DECISIONS_PREPAREES.md`), écrit et testé la partie la plus risquée et la plus difficile à
tester à distance (la base : schéma, RLS, droits Storage, fonctions, 117 assertions + concurrence), préparé le design, les textes,
les scripts de test et de mesure, et mis à jour le prompt.

## 2. Contradictions et ambiguïtés du cahier, et ce qui est décidé

| # | Dans le cahier V2 | Problème | Décision (voir `DECISIONS_PREPAREES.md`) |
|---|---|---|---|
| 1 | §6 : bucket public pour les photos publiées ; §14 : stockage privé + URL signées | Deux modèles incompatibles | Un seul bucket **privé** + URL signées (D01, D02) |
| 2 | §2 : galerie triée par nom, `storage.list` ; §14 : la base fait foi | Une liste Storage brute fuirait les photos privées/masquées ; la pagination par `offset` duplique des photos quand de nouvelles arrivent | Galerie lue par `gallery_page` (pagination *keyset*), testée avec 130 photos et dates identiques (D03, T17) |
| 3 | §6 : `status = published` pour une photo « mariés » ; §13 : « ne pas mélanger visibilité et état » | `published` d'une photo privée prête à confusion | La visibilité dépend **uniquement** de `audience` ; `published` = « acceptée » (D04) |
| 4 | §4/§8 : deux HTML + admin ; §14 cite `partager.html` | Nombre de pages flou | `index.html` à 2 vues (`#galerie`, `#partager`) + `admin.html` (D14) |
| 5 | §4 : si NSFWJS échoue, « attente privée » **ou** erreur avec réessai | Choix laissé à Codex | Toujours `pending_review` / `model_unavailable`, libération groupée par l'admin (D08) |
| 6 | §5 : unicité `(photo_id, reporter_id)` ; §13 : restauration sans remasquage | Après restauration, le même navigateur ne pouvait plus jamais signaler, et d'anciens votes remasquaient | Restaurer **efface** les signalements (D11) |
| 7 | §6/§13 : doublons « par destination » | Cas d'une photo masquée/supprimée non précisé | Masquée = doublon, supprimée = libère l'empreinte (D10) |
| 8 | §5 : motifs « gênante / enfant / autre » ; maquette : « Contenu inapproprié / Comportement… / Visages non consentis » | Deux listes | Motifs du cahier (D11) |
| 9 | §3/§15 : navigation limitée à 2 liens ; maquettes : 6 liens, langue FR, hamburger, filtres, « invités actifs », onglet Activité | Les maquettes dépassent le périmètre | Le cahier gagne ; liste détaillée dans `assets/DESIGN_NOTES.md` (D21) |
| 10 | §2/§15 : `?k=` conservé ; §6 : « pas un contrôle de confidentialité » | Cohérent, mais `?k=` fuit dans l'en-tête Referer vers polices et CDN | `Referrer-Policy: no-referrer`, polices et JS auto-hébergés (D16, D17) |
| 11 | §9 : tests T01–T20 sans lieu d'exécution possible sans Supabase | Codex ne peut pas tester les RLS sans accès distant | `supabase/tests/run_local.sh` exécute les tests de droits sur un Postgres ordinaire (D04) |

## 3. Risques réels que le cahier ne résout pas

**R1. Quota et trafic Supabase : le plus probable des incidents.** Hypothèse à confirmer sur vos photos : 350 Ko par photo
« full » 1600 px et 30 Ko par miniature (`python3 scripts/estimate_storage.py --assume-full-kb 350`).

| Photos reçues | par invité | Stockage | Offre gratuite (1 Go / 5 Go de trafic) | Offre Pro (100 Go / 250 Go) |
|---|---|---|---|---|
| 1 300 | 10 | 0,5 Go | stockage OK, trafic à risque (≈ 5,6 Go avec les téléchargements des jours suivants) | OK |
| 3 250 | 25 | 1,3 Go | dépasse | OK |
| 5 200 | 40 | 2,0 Go | dépasse | OK |
| 7 800 | 60 | 3,0 Go | dépasse | OK |

Trafic de la soirée estimé à 2,8 Go (130 invités, 6 chargements de galerie, 25 photos ouvertes, 10 téléchargées chacun),
à doubler avec les téléchargements des jours suivants. D'après un article de juillet 2026 (à vérifier sur la page officielle
des tarifs), l'offre gratuite coupe le service au quota quand aucun moyen de paiement n'est enregistré, et met le projet en
pause après 7 jours d'inactivité. **Recommandation : prendre l'offre Pro (25 $/mois d'après cette source) pour octobre, puis
résilier ou migrer après le mariage.** C'est votre décision (dépense), à prendre avant le 25.

**R2. Dépôt anonyme sur Storage : un point à vérifier en 5 minutes.** Le modèle suppose qu'un invité sans compte peut déposer
un fichier avec une simple policy INSERT. PostgreSQL refuse un `INSERT … RETURNING *` sans policy SELECT ; si l'API Storage
procède ainsi, tous les envois échoueraient avec « row-level security ». Je n'ai pas pu le vérifier hors d'un vrai projet.
Procédure et plan B (Edge Function d'URL signées, déjà écrite mais non testée) : `supabase/README.md`, sections 2 et 5.

**R3. Saturation volontaire.** La clé publique est visible dans le site : quelqu'un de malveillant peut déposer des JPEG (≤ 3 Mo)
jusqu'à saturer le quota ; `?k=` n'y change rien. Mitigation en place : bucket limité à JPEG 3 Mo, chemins stricts, plafond
de 500 envois / 24 h par navigateur (contournable), `admin_status().storage_bytes` pour surveiller. Risque résiduel accepté, très
improbable pour 130 invités. Si un abus apparaît : plan B + restriction.

**R4. « Deux signalements » ≠ deux personnes.** Une personne malveillante peut masquer n'importe quelle photo avec deux
identifiants de navigateur ; l'admin la restaure en un geste. Le mécanisme protège contre les doubles clics et les erreurs, pas
contre un acteur hostile. Le cahier le dit ; l'interface aussi (D11, `COPY_FR.md`).

**R5. NSFWJS sur iPhone.** Mémoire et lenteur à craindre. Atténuations : chargement au premier envoi public seulement, classification
de la miniature 400 px, une image à la fois, délais maximum, drapeau de repli (D08). Avec le repli, les envois publics passent en
attente de validation : prévoir que le témoin libère en bloc.

**R6. Le lien du QR (`?k=`) dans les en-têtes Referer et les polices Google.** Corrigé par D16/D17 (et bénéfice RGPD).

**R7. Projet gratuit endormi.** Si l'offre gratuite est conservée, le projet se met en pause après 7 jours sans activité :
tester chaque semaine jusqu'au mariage.

**R8. Vie privée.** Le réencodage par canvas supprime les métadonnées EXIF (dont le GPS) : point positif ; ces fichiers ne sont
pas les originaux (affiché à l'invité). Galerie contenant des enfants : `noindex`, pas de moteur de recherche, QR non publié (D18).

**R9. Planning.** Le 11 octobre, il reste 14 jours avant le gel du 25. Le chemin critique est humain (compte Supabase, tests sur
téléphones), pas le code : voir `ACTIONS_HUMAINES_PREREMPLI.md`.

## 4. Ce qui a été préparé, et ce qui a été réellement vérifié

| Élément | Fichier | Statut |
|---|---|---|
| Schéma, index, RLS, droits par colonne | `supabase/migrations/0001…0003` | **Testé** sur PostgreSQL 16 local (stub), rejouable 2 fois |
| Fonctions : envoi, doublons, signalement atomique, pagination, admin | `0002_functions.sql` | **Testé** (117 assertions, toutes PASS) |
| Concurrence : 2 signalements simultanés, double clic | `tests/run_local.sh` (T12) | **Testé** : PASS avec le verrou, FAIL sans (mutation vérifiée) |
| Les tests savent échouer | mutations : verrou retiré, filtre `published` retiré, droit de colonne rouvert | **Vérifié** : les tests passent au rouge |
| Policies Storage, API Storage réelle, URL signées, Auth | — | **NON TESTÉ** (nécessite un projet Supabase) |
| Edge Function du plan B | `supabase/functions/upload-url` | **NON TESTÉ** |
| Script de copie locale des bibliothèques + modèle NSFWJS | `scripts/vendor.sh` | **NON TESTÉ** (pas d'accès npm ici) |
| Photos de test (doublon exact, rafale, EXIF, PNG, fichiers invalides) | `scripts/make_test_images.py` | Testé (génération + empreintes) |
| Estimation stockage/trafic | `scripts/estimate_storage.py` | Testé ; chiffres réalistes seulement avec vos vraies photos |
| Design : couleurs mesurées, notes, textes | `assets/` | Couleurs mesurées sur les maquettes ; rendu non testé |
| Interface, upload côté navigateur, NSFWJS, lightbox, admin | — | **À écrire par Codex** |

## 5. Ce que Codex ne peut pas faire et que vous devez fournir

Détail daté : `ACTIONS_HUMAINES_PREREMPLI.md`. En résumé : (1) prénoms réels ; (2) `couple.jpg` ; (3) lieu à afficher ou non ;
(4) projet Supabase + exécution des 3 SQL + vérification n°1 ; (5) e-mail(s) admin (vous et le témoin) ; (6) décision de plan
Supabase ; (7) hébergement (Netlify / Cloudflare Pages) ; (8) tests sur vrais iPhone et Android ; (9) QR code imprimé et testé.
