# Filtre automatique d'images : audit, mesures et décision (11 octobre 2026)

**Conclusion** : le filtre automatique du navigateur est une aide de tri, pas une protection. Aucune solution testée ne permet d'affirmer qu'un
objet comme un sextoy sera détecté, et aucun détecteur complémentaire n'a été ajouté faute d'efficacité démontrée. **La protection fiable est la
validation avant publication** (réglage de l'administration, appliqué côté serveur).

## 1. Le filtre actuel (audit du code)
- **Où** : dans le navigateur de l'invité (`uploads.js`), jamais sur le serveur ; uniquement pour les envois vers la galerie commune. Les envois « mariés » ne sont pas analysés (`skipped`).
- **Bibliothèque** : NSFWJS 4.4.0 (MIT) + TensorFlow.js 4.22.0, modèle **MobileNetV2** (2,6 Mo de poids), entrée 224 × 224, appliqué à la miniature (800 px) ; ni catégorie « objet », ni détection locale.
- **Catégories** : `Drawing`, `Hentai`, `Neutral`, `Porn`, `Sexy` (probabilités qui somment à 1). Elles décrivent du contenu pornographique, de la nudité et des images suggestives de **personnes**.
- **Seuils** : `suspect` si Porn + Hentai ≥ 0,60, ou si Sexy ≥ 0,85 **et** Porn + Hentai ≥ 0,25. « Sexy » seul ne bloque jamais (robes, danse).
- **Échec** : chargement > 15 s, calcul > 8 s ou erreur ⇒ verdict `unavailable` (et le modèle est désactivé pour le reste de la session de l'invité).
- **Verdict transmis** : `clean`, `suspect`, `unavailable` ou `skipped` à `register_photo`, qui décide du statut **côté serveur** :

| Verdict | Validation active | Validation inactive |
|---|---|---|
| `clean` | en attente (`paused`) | publiée |
| `suspect` | en attente (`nsfw`) | en attente (`nsfw`) |
| `unavailable` / `skipped` | en attente (`model_unavailable`) | en attente (`model_unavailable`) |

Un verdict inconnu (`published`, `CLEAN`, `null`, injection) est rejeté (22023). Un navigateur modifié peut cependant déclarer `clean` : avec la validation inactive la photo serait publiée ; **avec la validation active elle reste en attente** (prouvé sur la pile locale réelle, voir CHECKLIST_TESTS).

## 2. Pourquoi un objet sexuel isolé passe
NSFWJS n'a jamais été entraîné à reconnaître cet objet : une photo d'objet est classée `Neutral`. Abaisser le seuil de `Sexy` n'y changerait rien (la probabilité de Porn/Hentai/Sexy reste faible) et bloquerait des photos normales. Le filtre est de plus contournable (verdict choisi par le client). Une détection d'objets ne peut venir que d'un autre modèle, dont l'efficacité doit être démontrée sur des **images réelles de positifs** que je ne peux ni produire ni télécharger.

## 3. Modèles évalués (`scripts/evaluate-detector.mjs`, local, hors ligne)
Banc : 16 images **négatives** : 13 photographies ordinaires locales (5 portraits de mariage, repas, restaurant, portrait, paysage de neige, plats…) et 3 images synthétiques volontairement piégeuses (grands aplats chair, tissus beiges, roses). **Aucun positif** n'était disponible : le taux de détection n'a pas pu être mesuré.

| Modèle (licence) | Poids | Chargement / calcul (Chromium bureau, **sans WebGL**, ordre de grandeur) | Faux positifs (16 négatifs, seuils actuels) | Porn+Hentai max / Sexy max | Détection de sextoys |
|---|---|---|---|---|---|
| NSFWJS **MobileNetV2** (actuel, MIT) | 2,6 Mo | 0,7 s / 0,76 s | **0 / 16** | 0,087 / 0,713 | non mesurable (pas de positif) ; pas de catégorie « objet » |
| NSFWJS MobileNetV2Mid (MIT) | 4,3 Mo | 1,2 s / 1,06 s | 0 / 16 | 0,046 / 0,004 | idem |
| NSFWJS InceptionV3 (MIT) | 22,4 Mo | 8,3 s / 7,2 s | 0 / 16 | 0,067 / 0,062 | idem ; trop lourd pour un téléphone |
| CLIP ViT-B/32 zéro-shot via Transformers.js (licence OpenAI CLIP, Apache pour la bibliothèque) | **≈ 89 Mo** (image, int8) + textes précalculables | 3,2 s / 16 ms (Node CPU, ordinateur ; ×10 à ×50 sur téléphone) | **1 photo ordinaire sur 16 classée « adult toy » à 0,41** ; trois images abstraites entre 0,10 et 0,17 | — | non mesurable ; le score sur les négatifs montre qu'aucun seuil n'est utilisable sans positifs |
| MobileCLIP-S0 | 12 Mo (image) | — | non évalué | — | licence « other » (recherche), exclu |
| Marqo/nsfw-image-detection-384 (Apache-2.0) | 22 Mo | — | non évalué (format non ONNX) | — | modèle NSFW général, pas d'objet |
| Falconsai/nsfw_image_detection (Apache-2.0) | 343 Mo (≈ 86 Mo quantifié) | — | non évalué | — | modèle NSFW général, trop lourd |

Les temps ne représentent pas un téléphone (aucun appareil physique n'a été testé). Le banc est petit : ces chiffres donnent une idée, pas une garantie.

## 4. Décision
- **Aucun détecteur ajouté** : aucun candidat n'a démontré qu'il détecte des sextoys ; l'un (CLIP) produit déjà des faux positifs sur des photos ordinaires et pèse ≈ 89 Mo à télécharger sur chaque téléphone.
- Les règles voulues existent déjà côté serveur : photo suspecte ⇒ en attente quel que soit le réglage ; modèle indisponible ⇒ en attente avec message adapté ; photo normale publiée seulement si la validation est inactive ; photos privées inchangées.
- **Recommandation pour le mariage : garder la « Validation avant publication » activée**, avec le témoin qui valide en continu (file « En attente » en lot sur téléphone).
- **Si vous voulez continuer** : fournissez localement des images de test (positifs : l'image qui a passé le filtre ; négatifs : vos photos de mariage). Lancez :
  `node scripts/evaluate-detector.mjs --negatives DOSSIER_NEGATIFS --positives DOSSIER_POSITIFS` (NSFWJS) ou `scripts/evaluate-clip-zeroshot.mjs` (voir son en-tête). Les images restent sur votre machine, ne sont pas ajoutées à Git et ne sont envoyées à aucun service.
- **Vérification côté serveur (proposition séparée, non faite)** : seule une analyse sur le serveur résiste à un navigateur modifié. Options : une Edge Function Supabase ou un Worker Cloudflare appelant un modèle open source (CPU limité, poids élevé) ou un service d'IA externe (**les images partiraient chez un fournisseur : votre accord est requis**). À étudier seulement avec des positifs réels pour mesurer l'efficacité.
