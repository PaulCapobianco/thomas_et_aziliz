# Plan de migration vers Cloudflare R2 — étude uniquement (rien n'est migré, aucun bucket créé)

Les prix et quotas ci-dessous sont **indicatifs** (connaissances à la date de rédaction) : à vérifier sur https://developers.cloudflare.com/r2/pricing/ et https://developers.cloudflare.com/workers/platform/pricing/ avant toute décision. R2 exige un moyen de paiement enregistré sur le compte, même pour son palier gratuit : **c'est votre décision, je ne l'active pas**.

## 1. Faut-il migrer ? (honnêtement)

Avec le pipeline actuel (≈ 616 Ko par photo, voir CHECKLIST_TESTS) : 3 000 photos ≈ 1,9 Go, 5 000 ≈ 3,2 Go, 10 000 ≈ 6,3 Go (jusqu'à 10-12 Go si les photos sont très détaillées).

| | Supabase Pro (≈ 25 $/mois) | R2 + Workers |
|---|---|---|
| Stockage inclus | 100 Go | 10 Go gratuits, puis ≈ 0,015 $/Go/mois |
| Trafic sortant | 250 Go inclus | **gratuit** |
| Coût pour 10 000 photos | forfait 25 $ | ≈ 0 à 5 $ (voir §5) |
| Complexité | aucune (déjà testé) | nouvelle couche à écrire et tester (Worker, signatures, migration 0004) |
| Risque avant le 31 octobre | nul | **élevé** (gel des fonctions le 25) |

Recommandation : **ne pas migrer avant le mariage**. Prendre Supabase Pro pour octobre (ou rester en gratuit seulement si < 1 Go et trafic < 5 Go, ce qui n'est pas le cas), puis envisager R2 après l'événement si vous voulez réduire le coût ou conserver les originaux (plusieurs dizaines de Go : là R2 devient nettement plus intéressant).

## 2. Architecture cible (compatible Supabase Auth, RPC et RLS)

Principe : **PostgreSQL Supabase reste la source de vérité** (table `photos`, statuts, signalements, admin, Auth). R2 ne stocke que les octets. Chemins inchangés : `<audience>/<full|thumbs>/<uuid>.jpg`.

```
Navigateur ──► Pages Functions (Worker) ──► R2 (binding, privé)
      │                 │
      └──► Supabase (Auth, RPC gallery_page / report_photo / admin_*, RLS)  ◄── le Worker vérifie les statuts
```

**Dépôt (invités anonymes).**
1. Le navigateur demande `POST /api/upload` (ou une URL présignée courte `PUT`, 5 min, un seul chemin, taille ≤ 3 Mo, `Content-Type: image/jpeg`).
2. Le Worker valide : format du chemin (même regex que 0003), taille, type, **Cloudflare Turnstile** (anti-robots) et limite par IP/identifiant ; il écrit dans R2 (`env.PHOTOS.put`).
3. `register_photo` : la version actuelle lit `storage.objects` (Supabase) et ne peut plus vérifier les fichiers. Nouvelle migration **0004** (additive, jamais appliquée sans votre accord) : `register_photo_r2(...)` réservée à `service_role`, appelée par le Worker **après** `env.PHOTOS.head()` (existence, taille, type). La clé `service_role` n'existe que comme *secret du Worker* (`wrangler pages secret put`), jamais dans le navigateur ni Git. Les deux anciennes policies d'insertion Storage ne servent plus.

**Lecture publique.** `GET /img/<id>/<thumb|full>` : le Worker interroge Supabase (RPC ou lecture `photos` avec une clé à droits minimaux) pour vérifier `audience='public' and status='published'`, puis diffuse l'objet R2 (`Cache-Control: private, max-age=60`). Les URL ne portent aucune signature durable.

**Photos privées « mariés » et en attente.** Même route, mais le Worker exige un **JWT Supabase d'administrateur** (`Authorization: Bearer`) : vérification de la signature (JWKS du projet) puis contrôle `is_admin()` via RPC. Sans cela : 404.

**Masquage réel.** Le Worker re-vérifie le statut à chaque lecture (cache de 30-60 s maximum). Masquer ou supprimer dans l'admin rend donc l'image inaccessible en ≤ 1 minute, **sans le délai d'une heure des URL signées actuelles**. La suppression efface aussi l'objet (`env.PHOTOS.delete`) ; le bouton admin appelle `/api/admin/delete` (JWT admin).

**Admin.** L'écran actuel est conservé ; seules les fonctions `signPhotos` / `fullUrl` / `uploadObject` / `storage.remove` (déjà isolées dans `shared.js` et `uploads.js`, voir `uploadObject()` « point de remplacement ») changent de cible.

## 3. Étapes de migration (aucune n'est lancée)

0. Décision (vous) : activer R2 sur le compte, créer le bucket `mariage-photos` (privé, sans accès public ni domaine personnalisé).
1. Écrire et tester **en local** (miniflare/`wrangler dev`, pile réelle de `scripts/real-stack.sh`) : Worker, migration 0004, nouveaux tests (mêmes contrôles que `real-http-test.mjs` : privé illisible, masquage immédiat, doublons, concurrence).
2. Ajouter à `photos` une colonne `storage_backend text default 'supabase'` : lecture double pendant la bascule (le Worker sert `supabase` via l'API Storage tant que la ligne n'est pas migrée).
3. Copier les objets existants Supabase → R2 avec un script local (clé `service_role` en variable d'environnement locale uniquement, `rclone` ou S3 API), **copie sans suppression**, vérification des tailles et des empreintes, puis bascule ligne par ligne.
4. Après plusieurs jours sans incident : seulement alors, et avec votre accord, nettoyage des fichiers Supabase.
5. Retour arrière à tout moment : remettre `storage_backend='supabase'` (les fichiers d'origine n'ont pas été supprimés).

## 4. Points d'attention

- **Workers gratuit : 100 000 requêtes/jour.** Les images servies via le Worker comptent. 130 invités × (≈ 288 miniatures + 35 grandes photos) ≈ 42 000 requêtes : sous la limite mais pas avec une grande marge si le polling recharge souvent ; prévoir Workers Paid (≈ 5 $/mois) si nécessaire. Les fichiers statiques du site, eux, sont gratuits et illimités.
- Les images servies par le Worker ne profitent pas automatiquement du cache CDN long (c'est le prix du masquage réel).
- Limites R2 gratuites (indicatives) : 10 Go, 1 M opérations d'écriture, 10 M opérations de lecture par mois.
- Sécurité : Turnstile et limites par IP ne protègent pas parfaitement un Wi-Fi partagé ; garder le plafond par navigateur côté base.
- Le modèle NSFW reste dans le navigateur (inchangé).

## 5. Estimation de coût (10 000 photos, 1 mois, indicatif)

| Poste | Volume | Coût |
|---|---|---|
| Stockage R2 | ≈ 6,3 Go (≤ 10 Go gratuits) | 0 $ |
| Écritures (2 par photo) | 20 000 | 0 $ (≤ 1 M) |
| Lectures | ≈ 42 000 pour la soirée, quelques centaines de milliers avec les jours suivants | 0 $ (≤ 10 M) |
| Sortie réseau | quelques Go | 0 $ |
| Workers (si > 100 000 req/jour) | — | ≈ 5 $ |
| **Total** | | **≈ 0 à 5 $** (contre 25 $ pour Supabase Pro) |

Conclusion : R2 est rentable surtout pour conserver des **originaux** (stockage ×6 à ×10) ou pour des volumes durables ; pour 130 invités et ≤ 10 000 photos compressées, l'économie est de ≈ 20 $ pour un risque et un travail non négligeables avant la date.
