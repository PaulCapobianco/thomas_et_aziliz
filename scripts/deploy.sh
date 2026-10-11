#!/usr/bin/env bash
# Republish the site on Cloudflare Pages (Direct Upload of dist/ only). First time: `npx wrangler login` once.
#   npm run deploy            checks + build + safety scan + publish to production
#   npm run deploy -- --test  also runs the browser test suite first
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT=thomas-aziliz-mariage
npm run check
if [ "${1:-}" = "--test" ]; then npm test -- --reporter=line; fi
npm run build
# The public config must be filled, and no private key may be inside the published folder.
grep -q 'SUPABASE_URL = "https://' dist/config.js || { echo "ARRÊT: SUPABASE_URL vide dans config.js"; exit 1; }
grep -q 'SUPABASE_KEY = "sb_publishable_\|SUPABASE_KEY = "eyJ' dist/config.js || { echo "ARRÊT: clé publique absente de config.js"; exit 1; }
if grep -rEq 'sb_secret_[A-Za-z0-9_-]{16,}' dist; then echo "ARRÊT: clé secrète détectée dans dist/"; exit 1; fi
node -e '
  const fs=require("fs"),path=require("path");
  const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
  for (const f of walk("dist")) { if (!/\.(js|html|css|json|txt)$/.test(f)) continue;
    for (const m of fs.readFileSync(f,"utf8").matchAll(/eyJ[A-Za-z0-9_-]{15,}\.([A-Za-z0-9_-]{15,})\.[A-Za-z0-9_-]{10,}/g)) {
      try { if (JSON.parse(Buffer.from(m[1],"base64url")).role === "service_role") { console.error("ARRÊT: JWT service_role dans "+f); process.exit(1); } } catch {} } }'
npx wrangler pages deploy dist --project-name "$PROJECT" --branch main --commit-message "deploy $(git rev-parse --short HEAD 2>/dev/null || echo local)"
