// One-time local helper: creates the PRIVATE Drive folders and prints their ids. Creates nothing public, shares nothing.
//   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REFRESH_TOKEN=... node scripts/drive-setup.mjs
// Run it once only (a second run would create a second set of folders).
import { refreshAccessToken, createFolder } from "../functions/_lib/drive.js";

const ROOT = process.env.DRIVE_ROOT_NAME || "Mariage Thomas & Aziliz"; // set e.g. "TEST - Mariage" for the isolated test run
const token = await refreshAccessToken(fetch, process.env);
const existing = await (await fetch(
  "https://www.googleapis.com/drive/v3/files?fields=files(id)&q=" + encodeURIComponent(`name='${ROOT.replaceAll("'", "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`),
  { headers: { authorization: `Bearer ${token}` } },
)).json();
if (existing.files?.length) {
  throw new Error(`Le dossier existe déjà (id ${existing.files[0].id}). Rien n'a été créé : réutilisez les identifiants déjà notés.`);
}
const root = await createFolder(fetch, token, ROOT);
const pub = await createFolder(fetch, token, "Photos publiques", root.id);
const priv = await createFolder(fetch, token, "Photos privées - Mariés uniquement", root.id);
console.log(`DRIVE_FOLDER_PUBLIC=${pub.id}\nDRIVE_FOLDER_PRIVATE=${priv.id}\n(dossier principal : ${root.id})`);
