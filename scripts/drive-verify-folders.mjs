// READ-ONLY check that the Drive backup folders are private. Changes nothing, creates nothing, deletes nothing.
//   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REFRESH_TOKEN=... \
//   DRIVE_FOLDER_PUBLIC=... DRIVE_FOLDER_PRIVATE=... node scripts/drive-verify-folders.mjs
// Prints only names, ids and PASS/FAIL (no secret). Scope drive.file sees the folders created by this app.
import { refreshAccessToken } from "../functions/_lib/drive.js";

for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "DRIVE_FOLDER_PUBLIC", "DRIVE_FOLDER_PRIVATE"])
  if (!process.env[k]) { console.error(`NON TESTÉ: ${k} absente de CETTE session (voir GUIDE_DRIVE.md, saisie sécurisée).`); process.exit(2); }
const token = await refreshAccessToken(fetch, process.env);
const get = async (path) => { const r = await fetch(`https://www.googleapis.com/drive/v3/${path}`, { headers: { authorization: `Bearer ${token}` } }); return { status: r.status, body: await r.json() }; };
let failures = 0;
const ok = (name, cond, extra = "") => { if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };
const about = await get("about?fields=storageQuota,user(emailAddress)");
const q = about.body.storageQuota || {};
console.log(`Compte Drive : ${about.body.user?.emailAddress ? about.body.user.emailAddress.replace(/^(.).*(@.*)$/, "$1***$2") : "?"} | utilisé ${(Number(q.usage || 0) / 1e9).toFixed(2)} Go sur ${q.limit ? (Number(q.limit) / 1e9).toFixed(0) + " Go" : "illimité"}`);
for (const [label, id] of [["Photos publiques", process.env.DRIVE_FOLDER_PUBLIC], ["Photos privées", process.env.DRIVE_FOLDER_PRIVATE]]) {
  const f = await get(`files/${id}?fields=id,name,mimeType,shared,trashed,ownedByMe,parents,permissions(id,type,role),webViewLink`);
  if (f.status !== 200) { ok(`${label} : dossier accessible`, false, `HTTP ${f.status} (le jeton n'a accès qu'aux dossiers créés par l'application)`); continue; }
  const perms = f.body.permissions || [];
  ok(`${label} : « ${f.body.name} » est un dossier, à vous, pas dans la corbeille`, f.body.mimeType === "application/vnd.google-apps.folder" && f.body.ownedByMe && !f.body.trashed);
  ok(`${label} : non partagé (shared=false)`, f.body.shared === false || f.body.shared === undefined);
  ok(`${label} : aucune permission 'anyone' ni 'domain' (seul le propriétaire)`, perms.length >= 1 && perms.every((p) => p.type === "user" && p.role === "owner"), `permissions=${perms.map((p) => `${p.type}/${p.role}`).join(",") || "aucune lisible"}`);
}
const kids = async (id) => (await get(`files?q=${encodeURIComponent(`'${id}' in parents and trashed=false`)}&fields=files(id,name,shared,mimeType)&pageSize=100`)).body.files || [];
const pubKids = await kids(process.env.DRIVE_FOLDER_PUBLIC), privKids = await kids(process.env.DRIVE_FOLDER_PRIVATE);
ok("aucun fichier partagé dans les deux dossiers", [...pubKids, ...privKids].every((x) => !x.shared), `${pubKids.length} fichier(s) publics, ${privKids.length} privés`);
console.log(`\nRÉSULTAT : ${failures ? failures + " FAIL" : "tout est PASS"} — API Google RÉELLE, lecture seule`);
process.exit(failures ? 1 : 0);
