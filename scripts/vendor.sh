#!/usr/bin/env bash
# Copie en LOCAL (dans ./vendor) les bibliothèques JS et le modèle NSFWJS, pour ne dépendre d'aucun CDN le soir du mariage.
# NON TESTÉ (nécessite npm et un accès réseau) : lire la sortie, ajuster les chemins si le contenu des paquets a changé.
# Versions : épingler des versions EXACTES (npm view <paquet> version) et noter les choix dans DECISIONS.md.
set -euo pipefail
cd "$(dirname "$0")/.."
SUPABASE_JS="${SUPABASE_JS:-2}"          # ex. 2.58.0 : épingler
TFJS="${TFJS:-4}"                        # nsfwjs 4.x attend tfjs 4.x : vérifier `npm view nsfwjs peerDependencies`
NSFWJS="${NSFWJS:-4}"                    # épingler aussi
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p vendor/nsfwjs
( cd "$TMP"
  npm pack "@supabase/supabase-js@${SUPABASE_JS}" "@tensorflow/tfjs@${TFJS}" "nsfwjs@${NSFWJS}" >/dev/null
  for f in *.tgz; do mkdir -p "x/${f%.tgz}" && tar -xzf "$f" -C "x/${f%.tgz}"; done )
SB=$(find "$TMP/x" -path '*supabase-js*' -name 'supabase.js' -path '*umd*' | head -1)
TF=$(find "$TMP/x" -path '*tfjs*' -name 'tf.min.js' | head -1)
NS=$(find "$TMP/x" -path '*nsfwjs*' -name 'nsfwjs.min.js' | head -1)
MODELS=$(find "$TMP/x" -path '*nsfwjs*' -type d -name models | head -1)
for v in "$SB" "$TF" "$NS" "$MODELS"; do [ -n "$v" ] || { echo "Fichier introuvable dans les paquets npm : adapter ce script"; exit 1; }; done
cp "$SB" vendor/supabase.js; cp "$TF" vendor/tf.min.js; cp "$NS" vendor/nsfwjs/nsfwjs.min.js
cp -r "$MODELS" vendor/nsfwjs/models
echo "OK : vendor/supabase.js, vendor/tf.min.js, vendor/nsfwjs/nsfwjs.min.js, vendor/nsfwjs/models/"
du -sh vendor
echo "Chargement : nsfwjs.load('/vendor/nsfwjs/models/mobilenet_v2/')  (voir le README du dépôt nsfwjs ; InceptionV3 = option { size: 299 })"
