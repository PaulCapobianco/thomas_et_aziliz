# Notes de design tirées des 3 maquettes

Les maquettes sont des **références de style**, pas des spécifications. Valeurs de couleur : `assets/design_tokens.css`.
Aucun nom, aucune date, aucun lieu des maquettes (« Louise & Antoine », « Villa Balbiano », 2024/2026 divergents) ne doit apparaître.

## Ce qu'il faut reprendre

**Écran 1 — Accueil / galerie** (`galerie_de_mariage_au_lac_de_côme.png`)
- Hero plein cadre : photo du couple, voile sombre dégradé du côté du texte, surtitre en petites capitales (« LE MARIAGE DE »), prénoms sur deux lignes en grand serif (le « & » démarre la 2ᵉ ligne), date en petites capitales espacées, bouton cuivre « Ajouter mes photos » avec icône d'envoi, sous-texte court.
- Sur téléphone : le hero reste fort mais le bouton doit être visible sans défiler (cahier §15).
- Section galerie : surtitre « NOS SOUVENIRS », titre serif « Les souvenirs de la soirée », grille éditoriale aux rangées de hauteurs voisines, fine séparation entre photos, fond très sombre.

**Écran 2 — Partager** (`interface_de_mariage_chic_sur_appareils.png`)
- Deux grandes cartes de choix avec bouton radio : « Partager avec les invités » (actif : fond terre cuite, icône de groupe) et « Envoyer uniquement aux mariés » (inactif : fond sombre, icône de cadenas). Texte d'aide sous chaque titre, avec les prénoms configurables.
- Encart « Un petit conseil » (icône ampoule, filet fin, fond surface) — texte exact : voir `assets/COPY_FR.md`.
- Bande « Vos photos sélectionnées (N) » : vignettes carrées avec croix de retrait ; lien « + Ajouter d'autres photos ».
- Bloc de progression : pastille ronde avec icône nuage, « 8 sur 12 photos téléchargées », barre fine cuivre, pourcentage **du lot traité** (pas des octets), bouton « Annuler ». Sur téléphone, ce bloc est ancré en bas de l'écran.

**Écran 3 — Administration** (`tableau_de_mariage_élégant_et_sécurisé.png`)
- Surtitre « ESPACE ORGANISATION », titre « Contrôle d'urgence », gros bouton cuivre « Suspendre la galerie publique » (devient « Reprendre… » quand en pause).
- Voyant d'état (point vert) « Galerie publique en ligne ».
- Onglets « Signalées (N) / Récentes » ; cartes de photos signalées avec pastille « 2 signalements », date relative, trois boutons **Masquer** (plein) / **Supprimer** / **Restaurer** (contour).
- Section « Dernières photos publiées » en vignettes.
- Sur téléphone ce sont des cartes empilées, boutons larges (≥ 44 px).

## Ce qu'il ne faut PAS reproduire (hors périmètre du cahier V2, §1, §3, §15)

| Dans les maquettes | Décision |
|---|---|
| Barre de navigation (Galerie, Infos, Cérémonie, Lieux, Notre histoire, Livre d'or), menu hamburger, sélecteur de langue « FR » | Non. Navigation limitée à **Accueil/Galerie** et **Partager** (2 liens). Pas de langue, pas de hamburger. |
| Onglets de filtres (Toutes, Cérémonie, Vin d'honneur, Soirée, Invités) | Non. Un seul flux de photos. |
| Compteur « Invités actifs » (186), « Photos publiées » (432) en vitrine | Non pour « invités actifs » (aucune donnée). Les compteurs utiles de `admin_status` (publiées, signalées, en attente, poids) suffisent, sobrement. |
| Onglet « Activité », lien « En savoir plus » du bandeau de signalement | Non. |
| Motifs de signalement des maquettes (« Contenu inapproprié », « Comportement inapproprié », « Visages non consentis ») et mention « Par un invité » | Non. Motifs du cahier : Photo gênante / Photo d'un enfant / Autre. Ne jamais afficher d'identifiant d'invité. |
| Fond « hero » photographique sur l'écran admin | Non : l'admin est sobre, fond uni. |
| Citation « Des instants pour toujours » | Optionnelle (texte statique) ; ne pas bloquer dessus. |
| Photos, lieu, date des maquettes | Jamais. Date réelle : 31 octobre 2026. Lieu uniquement s'il est configuré. |

## Typographies (indicatif)
Titrage : serif de contraste élevé (Cormorant Garamond ou Fraunces). Interface : sans-serif géométrique fine (Jost ou Inter), capitales espacées pour les surtitres et la navigation. Pas de police cursive, pas de cœurs décoratifs.
