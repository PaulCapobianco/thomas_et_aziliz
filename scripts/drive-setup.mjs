// One-time local helper: creates the PRIVATE Drive folders and prints their ids. Creates nothing public, shares nothing.
//   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REFRESH_TOKEN=... node scripts/drive-setup.mjs
// Run it once only (a second run would create a second set of folders).
import { refreshAccessToken, createFolder } from "../functions/_lib/drive.js";

const token = await refreshAccessToken(fetch, process.env);
const root = await createFolder(fetch, token, "Mariage Thomas & Aziliz");
const pub = await createFolder(fetch, token, "Photos publiques", root.id);
const priv = await createFolder(fetch, token, "Photos privées - Mariés uniquement", root.id);
console.log(`DRIVE_FOLDER_PUBLIC=${pub.id}\nDRIVE_FOLDER_PRIVATE=${priv.id}\n(dossier principal : ${root.id})`);
