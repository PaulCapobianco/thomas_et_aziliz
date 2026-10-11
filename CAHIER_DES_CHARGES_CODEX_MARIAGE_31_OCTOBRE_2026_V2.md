# Cahier des charges & prompt de mission — Album photo de mariage

**Version :** 2.0 — 11 octobre 2026 (mode agent autonome)  
**Échéance réelle :** site stable au plus tard le 25 octobre ; gel des nouvelles fonctionnalités après le 25, corrections critiques jusqu'au 27 ; départ du témoin le 29 ; mariage le 31 octobre 2026.  
**Charge de validation humaine disponible :** environ 10 h/semaine, à minimiser.  
**Destinataire :** Codex en mode autonome, puis éventuellement Claude Code pour un audit ciblé.

> **INSTRUCTION POUR CODEX :** Lis ce cahier des charges en entier et inspecte le `index.html` existant AVANT toute modification. Implémente directement une première version exécutable, robuste et testable. Prends des décisions techniques sobres et documente les arbitrages. Ne lance pas une réécriture en framework et ne complexifie pas inutilement la solution. Ne demande l'intervention humaine que pour les secrets, comptes, réglages distants ou choix bloquants qui ne peuvent pas être résolus dans le dépôt. Toute modification de sécurité ou de stockage doit être expliquée avant mise en production. Ne prétends jamais qu'un test réel est passé si tu ne l'as pas exécuté.


## 0. ORDRE DE MISSION AUTONOME — À LIRE EN PREMIER

**Livrer du code fonctionnel, pas une proposition ni un prototype non connecté.** La version finale doit être utilisable par environ 130 invités, prête **au plus tard le 25 octobre**, avec les 26–27 réservés aux bugs bloquants. Le propriétaire part le 29 octobre ; **son budget de temps n'est pas ton budget de calcul : travaille en autonomie sans lui demander de suivre chaque micro-étape**.

### Pouvoirs et limites de l'agent
- Tu es autorisé à lire tous les fichiers du dépôt, prendre les décisions de détail, créer/modifier les fichiers, installer de petites dépendances nécessaires, exécuter les tests, générer les migrations et créer des commits sur **ta propre branche de travail**. S'il n'y a pas de dépôt Git, initialise prudemment un dépôt local, ne force aucun push.
- **Ne demande pas la permission à chaque sous-tâche** : fais le travail, documente les arbitrages et avance. Regroupe uniquement les véritables actions humaines bloquantes à la fin dans `ACTIONS_HUMAINES.md`.
- **Pas d'action destructive distante** : ne supprime pas d'images, de tables, de buckets ou de données existantes ; ne déploie pas de migration sur la base de production sans autorisation explicite. Tu peux tester sur un environnement local ou de test disponible. Ne pousse pas en production sans validation humaine.
- Ne modifie pas des clés privées, des mots de passe ou des politiques d'accès en aveugle. La clé publique/anon **n'est pas** une clé secrète ; les clés `service_role` ou `sb_secret_*` le sont, elles ne doivent jamais être livrées au navigateur ou commitées.
- Fais preuve d'initiative technique **sur le produit convenu**, pas pour inventer du périmètre : pas de React, pas de base de données de photos supplémentaire, pas de chatbot, pas de likes ou commentaires, pas de galerie classée par événements, pas de compte pour chaque invité.
- Si l'accès distant à Supabase est absent, **continuer tout de même** : migrations SQL, fonctions serveur, simulations et tests locaux/mock, consignes de configuration concrètes. Ne prétends pas avoir validé des règles distantes réellement non déployées.
- Si un point non essentiel est ambigu, choisis l'option la plus simple et maintenable ; écris la décision dans `DECISIONS.md`. **Ne bloque pas toute la mission pour une question de décoration.**

### Décisions irrévocables pour ce MVP
1. **Trois écrans** : accueil + galerie publique, partage (public ou « mariés uniquement »), administration sur URL dédiée. Deux fichiers HTML publics + un HTML admin conviennent ; une vue partagée dans `index.html` convient aussi si elle simplifie, à condition que les trois parcours soient évidents.
2. **Une table `photos` pour les métadonnées**, une table `photo_reports` pour les votes, éventuellement les petites tables `admin_users` et `app_settings`. Ne pas multiplier trois tables de fichiers ou stocker les octets JPEG en PostgreSQL.
3. **Photos publiques publiées automatiquement** si filtre NSFWJS exécuté et résultat admissible. **Photos privées invisibles des invités** et non modérées par NSFWJS. **Photos suspectes invisibles des invités** jusqu'à action admin. Les faux positifs ne sont jamais supprimés automatiquement.
4. **Deux signalements comptabilisés côté base de données** ⇒ retrait automatique de la galerie. Un vote ne retire pas. La détection d'appareil ne prouve pas l'identité ; ne prétends pas le contraire.
5. **Masquage manuel prioritaire** : l'administrateur doit pouvoir retirer une image de la galerie depuis son téléphone. Les images privées doivent être réellement privées (Storage + RLS), même si cela nécessite des mécanismes de lecture distincts.
6. **Doublons strictement identiques seulement** (SHA-256 du fichier d'origine, par destination). Garder les clichés similaires et les rafales. Si le doublon est détecté pendant ou après l'upload, éviter de perdre/écraser la photo originale et traiter les objets temporaires.
7. **Une application résistante aux erreurs vaut plus qu'un effet spectaculaire.** Tous les contrôles essentiels doivent être testés ; réduire les animations avant de réduire la sécurité ou la fiabilité de l'envoi.
8. **Aucune photo, date ou lieu fictif sur le site final** : `couple.jpg` si fourni, sinon fallback esthétique ; prénoms configurables. Date réelle : 31/10/2026. Les maquettes utilisent des données illustratives qui ne doivent pas être reprises littéralement.

### Consigne de livraison autonome
**Ne termine pas après l'audit.** Audite, implémente par étapes, exécute ce que tu peux tester, corrige les erreurs détectées, documente précisément les opérations humaines finales et livre un état Git propre. À la fin, présente les fonctionnalités *fonctionnelles et vérifiées*, celles qui ne le sont pas et la liste minimale des éléments à configurer. Une suite de TODO vagues n'est pas un livrable.

---
## 1. Objectif produit

Une expérience **mobile-first**, très haut de gamme visuellement, pour environ **130 invités**, via un **QR code unique**, sans création de comptes invités ni application mobile à installer.

Le service propose :
1. une galerie publique qui se remplit au fil de la soirée ;
2. un parcours de dépôt à deux destinations : **« Partager avec les invités »** ou **« Envoyer uniquement aux mariés »** ;
3. une administration minimale, utilisable sur iPhone, permettant au témoin d'intervenir en urgence ;
4. un premier filtre automatique gratuit côté navigateur (**NSFWJS**) sur les contributions publiques, puis des **signalements communautaires** : **deux signalements distincts masquent automatiquement la photo dans la galerie**.

**Hors périmètre AVANT le mariage :** livre d'or, likes/commentaires, filtres par cérémonies, comptes mariés, reconnaissance faciale, tri de photos similaires, ZIP global, statistiques détaillées, traitement IA serveur payant, application native, tableau de bord complexe.

## 2. Code source existant — conserver le fonctionnel

Le dépôt contient un `index.html` existant. Il dispose déjà des fonctions suivantes :

- Constantes au début du script : `NAMES`, `DATE_TXT`, `SUPABASE_URL`, `SUPABASE_KEY`, `BUCKET`, `SECRET` : **les conserver, en haut de la configuration**. Ne pas inscrire des secrets privés en dur. `NAMES` peut rester configurable ; **ne pas utiliser « Louise & Antoine »**, qui n'était qu'un texte d'exemple de maquette.
- `SECRET` facultatif via paramètre `?k=`, mémorisé dans `localStorage` sous la clé `wk` ; ce mécanisme sert uniquement à orienter/dissuader, **pas à sécuriser des fichiers privés**.
- Client `@supabase/supabase-js@2` et fonction `resize(file,maxSide,quality)` côté navigateur.
- Export JPG `full/` **1600 px, qualité 0,8**, et `thumbs/` **400 px, qualité 0,7** ; même nom de fichier, deux fichiers dans Supabase Storage, écriture sans `upsert`.
- Galerie triée par nom descendant ; pagination par **48** ; bouton charger plus / actualiser ; miniatures en lazy loading.

**Règle :** préserver le comportement déjà correct et réutiliser au maximum le code existant. La nouvelle distinction public/privé, la sécurité et les statuts impliquent de modifier les accès aux fichiers et la source des métadonnées : le faire volontairement, avec une migration documentée, sans prétendre garder les appels existants à l'identique. Pas de régression sur l'envoi ou la pagination. Prévoir le cas où le dépôt ne dispose pas encore de configuration Supabase exploitable et fournir un état d'erreur/de démonstration explicite.

## 3. Direction artistique (priorité haute)

Style editorial / magazine de mode / hôtel de luxe, **pas de template mariage générique** :

- Fond anthracite très profond, ivoire chaud, accent terre cuite/cuivre mat ; variables CSS regroupées dans `:root` avec commentaires pour modification immédiate.
- Forte typographie serif de titrage (Cormorant Garamond, Fraunces ou équivalent) + sans-serif légère et lisible ; pas de police cursive kitsch, pas de cœurs décoratifs.
- Hero photographique spectaculaire avec `couple.jpg`, voile dégradé garantissant la lisibilité, prénoms très grands, date en petites capitales. Si `couple.jpg` manque : **fond alternatif esthétique sans image cassée**.
- Animations CSS légères, fine texture/grain, lignes délicates, apparitions au scroll discrètes (IntersectionObserver), `prefers-reduced-motion` respecté.
- Mobile-first : iPhone et Android en priorité ; zones tactiles >=44 px ; contrastes solides, focus visible, alt text, chargement des images progressif.
- Navigation limitée à **Accueil / Galerie** et **Partager**. Administration à URL dédiée, jamais exposée comme fonctionnalité publique.
- Les maquettes préexistantes montrent trois écrans : galerie/accueil, formulaire de partage, contrôle d'urgence. **Ne pas inventer des pages supplémentaires**.

## 4. Structure d'écrans (3 écrans, architecture légère)

### Écran 1 — Accueil et galerie
- Hero couple, prénoms configurables, date réelle **31 octobre 2026** (lieu uniquement si fourni/configuré), CTA « Ajouter mes photos ».
- Galerie publique en grille éditoriale responsive, 48 photos/page, pagination/lazy loading, bouton « Actualiser », état vide soigné.
- Ouverture en **lightbox plein écran** : swipe gauche/droite sur mobile, navigation clavier sur ordinateur, bouton Fermer clairement visible, bouton Télécharger. Le lien direct ne doit pas ouvrir un nouvel onglet.
- Action discrète « Signaler cette photo », accessible depuis le lightbox ; confirmation avant envoi ; retour utilisateur explicite (déjà signalée, envoyé, erreur).
- En cas de retrait ou de suspension : les nouvelles lectures de galerie ne montrent pas la photo masquée ; rechargement périodique léger ou manuel ; garder les téléchargements lisibles.

### Écran 2 — Partager les photos
- Deux choix explicites : « Partager avec les invités » (public, sélection par défaut) / « Envoyer uniquement aux mariés » (privé).
- Astuce sous les choix : « Un petit conseil : privilégiez vos plus beaux clichés et évitez d'envoyer plusieurs fois la même photo. Une seule suffit pour immortaliser le moment ! » ; ton bienveillant, non culpabilisant.
- Sélection multiple `accept=image/*`, vignettes des photos sélectionnées, possibilité de retirer une sélection, envoi séquentiel ou concurrence très limitée pour éviter de saturer la mémoire mobile, progrès X/N et % **du lot traité** (ne pas annoncer un pourcentage réseau byte-à-byte sans instrumentation réelle), confirmation du nombre envoyé/en échec ; bouton réessayer les échecs si possible.
- Gérer les formats habituels d'iPhone/Android (JPEG, PNG, HEIC/HEIF quand navigateur compatible), erreurs de décodage explicites, photos verticales, orientation EXIF et suppression des object URLs.
- Compression existante conservée à l'identique sauf correction technique avérée : 1600 px / 400 px ; **informer que ce ne sont pas les originaux haute résolution**. Les originaux sont un sujet distinct, hors MVP sans confirmation.
- Anti-doublon exact SHA-256 calculé sur le **fichier d'origine** ; doublons au sein du lot, puis détection globale dans la destination correspondante (public ou privé), avec une protection base de données contre deux uploads concomitants si possible. **Ne pas supprimer/masquer des photos simplement ressemblantes.**
- Pour le partage PUBLIC uniquement : NSFWJS local sur navigateur (modèle chargé/caché de manière efficiente, idéalement auto-hébergé pour fiabilité) ; classes réellement reconnues `Porn`, `Hentai`, `Sexy`, `Neutral`, `Drawing`. Définir des seuils conservateurs dans des constantes, journaliser uniquement la décision nécessaire ; `Sexy` seul ne doit pas conduire systématiquement à un blocage. Photos à risque : statut `pending_review`, jamais publiées immédiatement ; ne pas les effacer. **Si l'IA échoue à se charger, ne jamais afficher « photo vérifiée »** : soit dépôt en attente privée de vérification, soit erreur claire avec réessai, selon faisabilité et sécurité. Ne pas bloquer l'envoi privé aux mariés à cause du modèle IA.
- L'IA côté client est une **aide préventive, pas un contrôle de sécurité infalsifiable**. Ne pas présenter autrement.

### Écran 3 — Administration minimaliste (ex. `/admin.html`)
- Supabase Auth, réservé **au seul compte admin explicitement autorisé** via une liste en base ou équivalent sécurisé. Ne jamais mettre une clé `service_role`, un mot de passe ou un jeton admin dans le JS public. Vérifier les autorisations **côté serveur/DB**, pas seulement cacher le bouton.
- Sur téléphone, accès rapide : liste « Signalées / En attente / Récentes », aperçu, statut, motif/compteur ; actions « Masquer », « Restaurer », « Supprimer » (la suppression irréversible exige confirmation) ; « Suspendre / reprendre les nouvelles publications publiques ».
- Suspendre les nouvelles publications signifie : on peut **continuer à collecter des photos**, mais elles attendent ; la galerie publique existante peut rester consultable. Prévoir si possible une option distincte pour **masquer temporairement toute la galerie**, mais ne pas l'implémenter si cela compromet le planning.
- Préférer une interface admin sobre, non une plateforme d'analytics.

## 5. Signalements (priorité haute)

- Table `photo_reports` ; bouton « Signaler » dans la lightbox.
- Un premier signalement laisse la photo visible ; au **deuxième signalement distinct**, le statut bascule automatiquement en `hidden` et elle **disparaît de la galerie** ; pas de suppression automatique des fichiers.
- Sans comptes invités, identifier au minimum une installation navigateur par un UUID en localStorage (pas un simple compteur dans le JS). **Cela ne prouve pas qu'il s'agit de deux personnes différentes**. Ajouter une contrainte unique `(photo_id, reporter_id)` côté DB et des limites raisonnables de fréquence côté API/RPC ; idempotence des doubles clics et transactions concurrentes obligatoires.
- Une même personne peut contourner la distinction de navigateur : documenter honnêtement cette limite.
- Ne jamais laisser le client modifier directement `report_count`, `status` ou les droits admin. Le vote et le passage à `hidden` sont effectués atomiquement par une fonction/transaction côté serveur, avec droits strictement limités.
- Éventuellement demander un motif court « Photo gênante », « Photo d'un enfant », « Autre » ; cela ne doit pas rallonger sensiblement le parcours.
- Pour les photos masquées et photos réservées aux mariés, **ne jamais exposer de listes ni d'URLs de fichiers privés** à un invité.

## 6. Supabase et stockage — règle de sécurité impérative

Préférence : **conserver Supabase** pour accélérer, sans migration Cloudflare R2 avant la première version. Vu le nombre d'invités et les milliers d'images possibles, documenter le quota de stockage/transfert, estimer avec tests réels de poids des photos, et **demander une validation explicite du plan/capacité avant mise en production**. Ne pas assurer « gratuit » sans mesure.

Modèle recommandé :

```text
photos(
  id uuid primary key,
  audience text check (audience in ('public','maries')),
  status text check (status in ('published','pending_review','hidden','deleted')),
  filename text,
  full_path text,
  thumb_path text,
  original_sha256 text,
  nsfw_reason text null,
  created_at timestamptz,
  published_at timestamptz null
)

photo_reports(
  id uuid primary key,
  photo_id uuid references photos(id),
  reporter_id text,
  reason text null,
  created_at timestamptz,
  unique(photo_id,reporter_id)
)

app_settings(key text primary key, value jsonb)
admin_users(user_id uuid primary key)
```

Adapter le schéma au mieux, mais éviter trois tables quasi identiques pour les photos. `audience` et `status` font foi. Il faut fournir les migrations SQL, les contraintes, la configuration RLS, les règles storage et les opérations RPC/Edge nécessaires.

Séparation de stockage :
- Photos des mariés et photos en attente : **bucket privé** ; seuls administrateurs autorisés accèdent aux objets, conformément aux RLS/politiques Storage.
- Photos publiées : stockables dans un bucket public pour simplicité et performances, MAIS avertir que les anciens liens directs peuvent rester consultables/cachés après un masquage de l'interface. Si un retrait effectif du fichier accessible publiquement est requis, prévoir une opération serveur autorisée de déplacement/retrait vers stockage privé, avec stratégie de restauration. **Ne pas promettre la révocation instantanée des caches CDN.**
- Les dossiers `full/` et `thumbs/` du code initial doivent être conservés pour les photos publiques lorsque possible ; séparation du bucket pour privé/quarantaine recommandée.
- Appliquer les RLS : une requête publique n'obtient QUE les métadonnées `audience='public' AND status='published'`. Les uploads invités ne peuvent ni créer un faux admin ni modifier/effacer les fichiers d'autres invités.
- Protéger l'écriture contre les abus évidents (type MIME/poids/nombre de fichiers et fréquence). Aucune clé secrète/`service_role` côté client.
- L'ancien `SECRET` ?k= peut rester comme porte d'entrée pratique mais **pas comme contrôle de confidentialité**.
- Ajouter une migration/préparation des photos existantes si nécessaire, sans effacer de fichiers.

## 7. Robustesse et performances

- Performance prioritaire sur Safari iOS récent et Chrome Android ; tester aussi ordinateur.
- Réduire la mémoire : images redimensionnées une à une, objets temporaires libérés, chargement lazy, miniatures, pagination 48.
- Gestion d'erreurs réseau et quota : pas de fausse confirmation de succès si l'une des deux variantes échoue ; journaliser les noms des fichiers orphelins et proposer reprise/compensation si faisable.
- Détection de déconnexion en cours d'envoi, réessai sans duplication, feedback utilisateur.
- Accessibilité : clavier pour lightbox, fermer/Escape, focus, textes alternatifs, rôles de dialog, zones tactiles >=44px, `prefers-reduced-motion`.
- Mesurer réellement le poids des fichiers produits avec un jeu de photos ; estimer l'espace pour 1 300 / 3 250 / 5 200 / 7 800 images (taille réelle, pas hypothèse fixe).
- Mentionner les enfants : bouton signaler adapté ; ne pas utiliser de reconnaissance faciale ; ne pas collecter de données nominatives des invités.

## 8. Choix d'architecture et fichiers

**Privilégier le plus léger :** `index.html` comme point d'entrée invité (les écrans Accueil/Galerie et Partager peuvent être des sections vues dans une même page), `admin.html` isolé pour la gestion, et seulement les petits fichiers JS/CSS additionnels indispensables si réellement utiles. Pas de React/Vite/Next, pas de framework CSS, pas de build complexe ; Google Fonts et bibliothèques ciblées acceptées. Garder l'existant utilisable tant que le remplacement complet n'a pas passé les tests.

Prévoir `.env.example` / fichier de configuration documenté si nécessaire, jamais de vraies clés privées dans le dépôt. Éviter les dépendances payantes et l'infrastructure inutile.

## 9. Travail autonome demandé à Codex

Effectuer dans cet ordre, avec commits isolés et vérification à chaque étape :

1. **AUDIT initial** : relever structure du dépôt, fichiers, valeurs d'environnement, fonctions existantes, limites et risques de régression. Sauvegarder `index.html` original (Git/branche/commit). Expliquer brièvement l'architecture retenue dans `ARCHITECTURE.md`.
2. **UI** : refonte écran Accueil/Galerie, écran Partager, lightbox et états vide/erreur, conforme à la direction artistique.
3. **DATA & SÉCURITÉ** : migrations SQL idempotentes, storage, RLS, chemin public/privé ; fournir instructions manuelles si aucun accès distant disponible.
4. **UPLOAD** : conserver compression 1600/400, double destination, SHA-256, feedback, reprise en cas d'erreur ; éviter la publication des privés.
5. **MODÉRATION** : NSFWJS sur public, pending_review, système de signalement deux votes distincts et actions admin.
6. **ADMIN MOBILE** : login sécurisé et actions d'urgence.
7. **QA** : tests automatisés là où faisable, tests manuels rédigés pour iPhone/Android, contrôle droits non authentifiés, protection du stockage, petit test de charge simulant de nombreux ajouts, et instructions de déploiement.

### Critères de recette obligatoires

- [ ] Un invité atteint le site via le QR sans inscription.
- [ ] Il peut envoyer plusieurs photos publiques ; celles qui passent les contrôles apparaissent dans la galerie, sans rechargement complexe.
- [ ] Il peut choisir « mariés uniquement » ; **aucune URL ni photo privée n'est récupérable par un invité non autorisé**.
- [ ] Une photo explicitement suspecte n'apparaît pas dans la galerie.
- [ ] Les fichiers strictement identiques ne sont pas importés deux fois dans une même destination ; les photos simplement ressemblantes sont conservées.
- [ ] Un signalement ne masque pas ; deux votes distincts masquent, y compris en cas de simultanéité ; doublon du même navigateur refusé.
- [ ] L'admin peut immédiatement masquer/restaurer une photo et suspendre les nouvelles publications.
- [ ] Un invité ne peut pas s'accorder les droits admin ou changer lui-même un statut en modifiant les appels client.
- [ ] Galerie/lightbox/swipe/téléchargement, pagination 48, lazy load fonctionnent.
- [ ] `couple.jpg` absent = mise en page élégante, sans icône d'image cassée.
- [ ] Envoi depuis au moins un iPhone et un Android vérifié par l'humain avant déploiement définitif.
- [ ] Aucune promesse de confidentialité ou « IA infaillible » inexacte dans l'interface.

## 10. Livrables attendus en fin de session autonome

- Fichiers du site opérationnels + éventuel `admin.html`.
- Migrations SQL et RLS, opérations serveur/API indispensables, `.env.example` si utile.
- `README_DEPLOIEMENT.md` expliquant très précisément ce que l'humain doit cliquer/configurer, dans quel ordre (Supabase, bucket, Auth, domaine, QR code).
- `CHECKLIST_TESTS.md` avec scénarios rapides sur vrais téléphones et validation du signalement 2 votes.
- Liste brève des modifications, tests réellement exécutés et leurs résultats, avertissements ouverts, commandes de déploiement, commits Git.
- **Liste « BLOQUANTS AVANT 25 OCTOBRE »** limitée aux points impératifs. Pour les fonctionnalités non essentielles non terminées, proposer une désactivation sûre plutôt que livrer du code instable.

## 11. Décision de réduction de périmètre en cas de retard

Ordre de protection : **(1) réception et conservation des photos ; (2) confidentialité des photos privées ; (3) galerie publique ; (4) admin masquer d'urgence ; (5) 2 signalements ; (6) IA NSFWJS ; (7) finitions décoratives.**

Si NSFWJS pose des problèmes majeurs de performance sur iPhone, le mettre derrière un drapeau fonctionnel, conserver la capacité de signalement et d'administration, et documenter explicitement l'absence du premier filtre : ne pas faire semblant qu'il fonctionne.

Si le stockage disponible est insuffisant, arrêter toute tentative de lancement public, mesurer et signaler la nécessité d'augmenter le quota/forfait. Ne pas lancer une migration complète vers R2 sans gain de temps clairement établi et validation.

---

### Sources techniques à consulter lors de l'implémentation

- Supabase Storage buckets privés/publics : https://supabase.com/docs/guides/storage/buckets/fundamentals
- Accès RLS pour Storage : https://supabase.com/docs/guides/storage/security/access-control
- Téléchargement et URL signées : https://supabase.com/docs/guides/storage/serving/downloads
- NSFWJS README et modèles : https://github.com/infinitered/nsfwjs

**Rappel :** les maquettes fournies comportaient des exemples fictifs de prénoms, dates et lieux. Les données du mariage sont pilotées par les constantes de configuration et la photo `couple.jpg` réelle.


## 12. Matrice de décisions — éviter les interruptions inutiles

| Situation rencontrée | Décision attendue sans question | Ne demander une validation que si… |
|---|---|---|
| Le dépôt n'a pas d'outillage | HTML/CSS/JS statiques, bibliothèques ciblées ; ajouter un outil de test minimal si nécessaire | Un service payant ou un framework lourd serait indispensable |
| Les prénoms sont encore des placeholders | Garder `NAMES` configurable ; ne jamais inventer des prénoms | Les vrais prénoms doivent être publiés |
| `couple.jpg` absent | Dégradé/typographie élégants, pas de photo cassée | La vraie photo doit être intégrée |
| Aucune vraie URL Supabase dans le code | Développer avec configuration exemplaire et mocks ; documenter les variables à renseigner | Connexion réelle au projet nécessaire pour tests d'intégration |
| Supabase non connecté au CLI | Générer SQL, policies, Edge Functions et script de recette locale | Déploiement distant de ces éléments |
| Poids/quota Supabase inconnus | Mesurer les fichiers produits, estimer la capacité, proposer un seuil et un avertissement | Il faut acheter/changer un plan ou migrer vers R2 |
| HEIC incompatible sur un navigateur | Expliquer l'erreur et permettre d'autres JPEG/PNG ; conversion légère uniquement si éprouvée | Une dépendance lourde/mettant Safari à risque est requise |
| NSFWJS ne se charge pas | Éviter toute publication présentée comme « vérifiée » ; proposer réessai ou dépôt en attente privée si prévu et testé | Le fonctionnement imposerait une nouvelle infrastructure payante |
| Un changement d'UI entre en conflit avec la logique actuelle | Préserver l'upload et le chargement, adapter l'UI autour ; couvrir par test de non-régression | La modification changerait les garanties de sécurité |
| Fonction secondaire inachevée | Retirer/désactiver proprement, documenter, laisser le chemin critique utilisable | Le point touche une priorité vitale |
| Il faut ajouter une troisième route publique | Ne pas la créer, intégrer la fonction à l'un des trois écrans | Le parcours deviendrait inaccessible sans elle |

## 13. Flux fonctionnel détaillé et états vérifiables

### États (une photo n'est jamais visible avant finalisation)
- `uploading` (interne/facultatif) : emplacement réservé, mais ni publié ni affiché ; ne pas laisser une ligne incomplète apparaître comme galerie.
- `published` : `audience='public'` et ses deux variantes existent effectivement, photo listable.
- `pending_review` : contenu suspect ou publications en pause ; visible **seulement en administration**.
- `hidden` : retrait suite à deux signalements ou action admin, pas de liste publique.
- `private` n'est **pas un statut à créer** : une photo `audience='maries'` reste privée quelle que soit la mécanique d'état retenue. Ne jamais mélanger visibilité et état de modération.
- `deleted` : action admin de suppression explicite, avec confirmation ; privilégier un soft-delete ou une corbeille temporaire si simple.

### Envoi d'une image, ordre impératif
1. L'invité choisit la destination et sélectionne une ou plusieurs photos. Afficher le nombre, retirer un fichier sélectionné, libérer les aperçus temporaires.
2. Pour chaque photo : vérifier taille/type, lire correctement l'image, calculer le SHA-256 original. Vérifier les duplications dans le lot et, si possible, côté base pour la même destination **avant** d'envoyer les deux variantes.
3. Pour une destination publique uniquement : charger le modèle NSFWJS une fois, classifier une représentation redimensionnée en mémoire. Mettre `pending_review` si le résultat est suspect, et notifier sans exposer le diagnostic ou des probabilités inutilement.
4. Convertir en deux JPEG selon la logique existante : `full/` 1600 px q0.8, `thumbs/` 400 px q0.7. Si orientation/HEIC impossible, **signaler l'échec de ce fichier** sans interrompre les suivants.
5. Réserver/enregistrer des métadonnées cohérentes, uploader les deux objets, puis finaliser la ligne **uniquement lorsque les deux uploads réussissent**. Si interruption partielle : pas de publication, marquer pour nettoyage ou réparation, prévenir l'invité. Les clés d'objets doivent être générées de manière non collisionnelle.
6. `audience='public'` + filtre OK + publications activées : `published`. Si l'IA alerte ou si la publication est suspendue : `pending_review`. Si `audience='maries'` : jamais visible dans les requêtes invitées.
7. Retour utilisateur : `réussites / doublons ignorés / mises en attente / échecs`. Le pourcentage du lot correspond au **nombre d'éléments traités**, pas aux octets réseau.
8. Après finalisation, galerie rechargée ou actualisée avec un polling modéré ; pas de websocket à développer par défaut.

### Signalement et urgence
- Le bouton « Signaler » n'apparaît que pour une photo publique. Confirmation courte, un signalement par identifiant navigateur et par photo, idempotent (un second clic ne compte pas).
- Une RPC/Edge Function atomique vérifie que la photo existe et est encore publiée, insère le vote une seule fois, détermine le nombre **réel** de votes distincts et passe le statut à `hidden` au seuil de deux. Jamais une incrémentation du nombre effectuée par le navigateur.
- L'administrateur peut voir les statuts, masquer, restaurer et supprimer selon les droits. Restauration d'une photo masquée : **résoudre les anciens signalements** (nettoyage/archivage/epoch de modération) afin qu'elle ne soit pas immédiatement remasquée par des votes anciens.
- Le bouton « Pause » doit **bloquer les nouvelles publications, mais pas l'upload des invités**. À la reprise, éviter de publier automatiquement des photos auparavant jugées suspectes par l'IA. Les publications en attente simplement à cause de la pause peuvent être libérées via action distincte ou procédure documentée.
- Afficher une galerie qui ne liste que `published`. Expliquer la nuance : une URL signée préalablement délivrée ou une copie en cache peut rester accessible quelques instants après retrait ; réduire les TTL, ne pas promettre une révocation magique des navigateurs.

## 14. Architecture minimale sûre — règles non négociables

### Source de vérité
- PostgreSQL/`photos` = source d'autorité pour le statut, l'audience et le tri. **Ne plus déduire la galerie publique de `storage.list('thumbs')` sans filtrage** : une liste brute peut faire fuiter privés et masqués.
- Le contenu des buckets ne suffit pas à prouver l'état de publication. Une ligne `published` ne doit référencer que des fichiers intègres et présents.
- Préférer un modèle **Storage privé**, avec autorisations de lecture pour les médias **publiés seulement** et génération d'URLs temporaires pour les photos de la galerie. Le modèle peut être simplifié si le dépôt impose une autre solution, mais un retrait doit empêcher au minimum de nouveaux accès non autorisés, et aucune photo `maries`/`pending_review` ne doit être accessible aux invités. Documenter explicitement la durée de vie des éventuels liens déjà délivrés.
- Les invités ne peuvent jamais `SELECT` les fichiers `audience='maries'`, ni obtenir un signed URL qui pointe sur eux. Tester cela par requête anonyme indépendante de l'interface.
- Le stockage ne doit pas exposer publiquement des objets en attente ou masqués, même si un utilisateur devine leur chemin.
- Si lecture signée anonyme : RLS `storage.objects` doit autoriser **uniquement** les images publiques publiées. Appliquer les politiques aux opérations effectives de lecture/signature et vérifier les modes d'accès du SDK choisi ; ne pas confondre `createSignedUrl()` et `getPublicUrl()`.

### Voies d'écriture et intégrité
- Les uploads invités sans compte doivent être possibles avec des politiques d'**écriture seule très bornées** ou avec un court endpoint serveur/signed-upload-token. Ne jamais donner des droits anonymes génériques de `SELECT`, `UPDATE` ou `DELETE` sur tous les objets.
- Un client ne doit pas pouvoir se déclarer administrateur, modifier un statut après finalisation, réécrire les fichiers d'autrui ou effacer une image signalée. Les mutations sensibles passent par RPC/Edge Function avec contrôle de droits réel.
- Toute fonction anonyme exposée doit valider côté serveur son schéma d'entrée, la taille/type, le chemin attendu, l'existence des objets et les opérations permises. Prévoir limites basiques de rythme et idempotence ; tester les concurrents.
- Les clés privilégiées ne résident que côté serveur, jamais dans `index.html`, `partager.html`, `admin.html`, dans une URL publique ou dans un log client.
- Les Edge Functions sont un **moyen d'implémentation**, pas une obligation de multiplier les services : utiliser le minimum pour remplir la sécurité et l'intégrité. Réutiliser la configuration Supabase déjà en place si elle est saine.
- Si une solution technique facile est seulement une sécurité visuelle (par exemple cacher un lien CSS), **ne pas la livrer comme sécurité réelle** : documenter le blocage et préparer le bon mécanisme.

### Modèle de données : compléments à la section 6
- `photos.id`, `audience`, `status`, `storage_path_full`, `storage_path_thumb`, `original_sha256`, `created_at`, `updated_at`, `published_at`; statut de complétude/erreurs si nécessaire.
- Index `(audience,status,created_at DESC)` pour pagination ; contrainte d'unicité raisonnable pour `(audience, original_sha256)` (avec traitement du cas des suppressions).
- `photo_reports.photo_id`, `reporter_id`, timestamp, contrainte unique, RLS restrictive. Ne pas retourner les reporter IDs à tous les invités.
- `admin_users(user_id)` fondé sur Supabase Auth, inséré seulement depuis un contexte privilégié. Ne pas coder l'e-mail admin ni se baser sur un paramètre d'URL.
- `app_settings` peut stocker un booléen de suspension ; seule l'administration peut l'éditer.

## 15. Expérience et direction artistique : limites anti-dérapage

- Réutiliser les 3 maquettes comme **références de style**, pas comme données ou fonctionnalités contractuelles. Les noms et lieux illustratifs des images ne doivent pas être recopiés.
- Navigation claire et fluide entre `index.html` et l'envoi, avec propagation du mécanisme historique `?k=` (ou récupération depuis `localStorage`), sans en faire une protection d'accès.
- CSS `:root` : `--bg`, `--surface`, `--text`, `--muted`, `--accent`, `--accent-hover`, `--border` ; pas de dizaines de variables quasi identiques.
- Conserver une composition forte du hero au mobile, mais **CTA visible rapidement sans obliger à scroller un écran complet** sur les petits téléphones si la photo prend toute la hauteur.
- Progresser sans scroll-jacking, carrousels lourds ni bibliothèque d'animations. Les cartes et contrôles tactiles ≥44 px et un contraste lisible sont des contraintes de recette.
- Les filtres illustratifs « cérémonie », « réception », « invités » visibles sur certaines maquettes **ne doivent pas être développés** ; la galerie a un seul flux.
- Ne pas intégrer des images fictives dans la galerie réelle. Quand elle est vide, état vide éditorial haut de gamme, sans faux contenu.

## 16. Tests reproductibles que Codex doit réellement écrire/exécuter

Créer une check-list explicite avec résultat `PASS / FAIL / NON_TESTÉ` et preuves/commandes pour chaque cas. Quand l'accès externe manque, fournir les tests de manière exécutable et les déclarer **NON_TESTÉ** sur le serveur réel, pas `PASS`.

| ID | Scénario | Résultat exigé |
|---|---|---|
| T01 | Chargement sans `couple.jpg` | Aucun pictogramme cassé, hero beau et lisible |
| T02 | Ouvrir le site en URL QR `?k=` valide puis partager | Navigation et galerie restent accessibles sans réinsérer la clé |
| T03 | Envoi de 3 JPEG + 1 PNG, destinations publiques | 2 variantes JPEG créées, status final cohérent, galerie affichée |
| T04 | Envoyer 2 fois **le même fichier exact** dans la même destination | Pas de 2e entrée publiée ni écrasement de l'original |
| T05 | Photos très similaires mais différentes | Toutes conservées |
| T06 | Envoyer en « mariés uniquement » | Aucune ligne/URL/photo accessible depuis une session anonyme de consultation |
| T07 | Simuler `Porn`/`Hentai` hautement suspect via un résultat mock NSFWJS | Photo `pending_review`, invisible publiquement, conservée |
| T08 | Simuler un chargement impossible du modèle IA | Pas de fausse validation ni publication automatique supposée filtrée |
| T09 | Premier signalement | Photo visible, un seul vote comptabilisé |
| T10 | Double clic ou même navigateur/signature | Un seul vote, pas de retrait |
| T11 | Deux navigateurs distincts | La photo sort de la galerie, sans suppression définitive |
| T12 | Deux votes concurrents | Transition atomique, pas de compteur incohérent |
| T13 | Reconnexion admin | Accès autorisé avec compte admin, refus sans ce compte |
| T14 | Masquer / restaurer / suspendre les nouvelles publications | Fonctionne et persiste en base après rechargement |
| T15 | Admin restaure une photo signalée | Ne se remasque pas instantanément à cause des anciens votes |
| T16 | Interruption après l'upload du JPEG mais avant la miniature | Pas de photo publiée incomplète ; remontée d'erreur / réparation explicite |
| T17 | 48 puis 49 puis 200 photos | Pagination et tri sans dupliquer ou perdre les items |
| T18 | Lightbox tactile, Escape, clavier, téléchargement | Comportement et focus corrects |
| T19 | Tentatives RPC/storage directes depuis client invité | Impossible de changer le statut, de se rendre admin ou lire le privé |
| T20 | Préférence `prefers-reduced-motion` | Animations réduites ou supprimées |

**Tester les politiques et fonctions, pas uniquement le DOM**. Les mocks sont utiles pour le développement mais **ne remplacent pas** le contrôle d'accès réel en environnement de test. Si possible, écrire scripts de test Postgres/RLS et tests fonctionnels au moyen de Playwright (émulation mobile) ; ne pas annoncer « testé sur iPhone » sans appareil réel.

## 17. Budget, planning et stratégie anti-blocage

- **Budget humain : ~10 heures/semaine**, pas des sessions obligatoires de 3–4 heures quotidiennes. Codex doit travailler seul et produire une liste finale d'actions très courte. Éviter d'ajouter une bibliothèque complexe qui prendrait des heures à configurer.
- **Gel fonctionnel au 25 octobre** ; ne pas attendre le 30 pour découvrir des problèmes de quota ou de Safari.
- Priorité de risque : envoi effectif et fiable > confidentialité stricte > consultation publique > retrait d'urgence > signalements > premier filtre IA > décoration.
- **Si Supabase gratuit risque d'être saturé**, signaler le risque chiffré à partir de mesures d'images compressées ; fournir deux solutions : payer un mois de capacité suffisante OU migration R2 après le mariage. Ne pas migrer silencieusement toute l'infrastructure.
- **Si IA lente** : charger le modèle à la demande au premier envoi public, pas au chargement de la page ; traiter les photos par petits lots, libérer mémoire, proposer réessai clair. Si impossible, désactiver le mode public « vérifié » et basculer vers mise en attente ou signaler explicitement l'absence de filtrage, sans supprimer les capacités de partage privé.
- **Si les 2 votes sont impossibles à sécuriser sans fonction serveur**, implémenter la fonction serveur minimale ; ne pas bricoler un compteur JS. En mode secours, désactiver les signalements plutôt que livrer une fausse modération.
- **Si l'admin auth est non configuré** : fournir un `admin.html` fonctionnel en local, mais ne pas exposer les opérations admin sur production jusqu'à la configuration des droits.
- **À la fin du lot de développement**, l'utilisateur doit pouvoir exécuter une séquence de validation de 15–30 minutes ; pas lire un manuel de 100 pages.

## 18. Procédure Git et passage propre à Claude Code

1. Examiner `git status`, conserver les changements préexistants. Créer une branche de travail `feat/mariage-photos-mvp` ou équivalent sans écraser des modifications de l'utilisateur.
2. **Commits fonctionnels** recommandés : `ui/galerie`, `uploads/destinations`, `moderation/reports`, `admin/emergency`, `qa/docs`. Ne pas commiter un état manifestement cassé comme release.
3. Exécuter tests/build/lint réellement disponibles, corriger les régressions, laisser les commandes reproductibles dans le README.
4. Produire `HANDOFF_CLAUDE.md` : architecture finale, fichiers touchés, schéma/migrations non déployées, liste des tests réels/émulés/mock, limitations, commits, bugs bloquants, décision de gel de périmètre.
5. Claude Code doit ensuite intervenir **seulement pour auditer/corriger** : ne pas réécrire intégralement les interfaces, ne pas changer de stack, corriger en priorité les risques de fuite privée et de perte de photo.

## 19. Format du rapport final Codex — obligatoire

La dernière réponse autonome et `HANDOFF_CLAUDE.md` contiendront ces sections, dans cet ordre :

```text
1. FONCTIONNALITÉS TERMINÉES (preuve de fonctionnement)
2. FICHIERS CRÉÉS/MODIFIÉS
3. ARCHITECTURE ET CHOIX TECHNIQUES
4. TESTS EXÉCUTÉS : commande + PASS / FAIL / NON_TESTÉ
5. SÉCURITÉ : RLS / Storage / Admin / 2 votes
6. CONFIGURATIONS DISTANTES NON APPLIQUÉES
7. ACTIONS HUMAINES INDISPENSABLES (numérotées, max 10)
8. BLOQUANTS AVANT LE 25 OCTOBRE
9. LIMITATIONS ET FONCTIONS REPORTÉES
10. COMMITS ET ÉTAT GIT FINAL
```

Chaque action humaine doit indiquer **où cliquer, quoi copier, quel résultat attendu et comment vérifier**. Interdiction d'écrire seulement « configurez Supabase ».

## 20. Références, avertissements et qualité des livrables

- Ne pas remplacer les identifiants réellement fournis dans le code par des chaînes fictives ; ne jamais publier un code comportant une clé privilégiée dans le navigateur.
- Modèles NSFWJS : lire la documentation du dépôt et auto-héberger un modèle si cela améliore la fiabilité ; le dépôt indique explicitement que l'ancien modèle CloudFront peut ne plus être disponible. Les classifications ne démontrent pas l'absence de contenu inapproprié.
- Il n'existe pas de moyen sans authentification des invités de prouver deux **personnes** différentes derrière deux signalements. L'interface doit dire « deux signalements » plutôt que « deux personnes certifiées ».
- La galerie contenant des enfants ne doit pas être indexée par les moteurs de recherche : ajouter les mécanismes `noindex` pertinents et limiter la diffusion des QR codes, tout en rappelant que `noindex` ne remplace pas des règles de confidentialité.
- Favoriser un bouton de retrait d'urgence et un chemin de support simple, pas une usine à gaz RGPD.
- Les photos privées envoyées aux mariés ne sont **pas** une raison de désactiver les règles d'upload/poids ni d'exposer leurs fichiers à la galerie.
- Garder le code fonctionnel lisible ; éviter d'éparpiller la logique en dizaines de fichiers.

### Validation prioritaire à remettre à l'utilisateur
1. Ouvrir le QR sur iPhone, charger et envoyer 3 photos publiques ; elles apparaissent.
2. Envoyer une photo « mariés uniquement » ; elle est absente de la galerie et inaccessible en navigation privée.
3. Faire deux signalements depuis deux navigateurs ; la photo disparaît de la galerie.
4. Se connecter à `admin.html` depuis l'iPhone ; masquer/restaurer une photo.
5. Vérifier une photo au format iPhone ainsi que l'état d'erreur sur réseau mobile faible.
6. Contrôler le quota de stockage et que le lien du QR imprimé reste correct.

**Fin du cahier des charges V2. Aucun enrichissement du périmètre n'est attendu.**
