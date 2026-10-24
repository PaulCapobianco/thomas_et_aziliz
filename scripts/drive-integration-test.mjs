// Integration test of the Google Drive sync against the REAL Supabase components of the disposable local stack
// (scripts/real-stack.sh: PostgreSQL + Supabase Storage API + PostgREST) and either:
//   --google=fake   a local imitation of the Google endpoints (no account, no secret)   [default]
//   --google=live   the REAL Google Drive API, with GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN
//                   read from YOUR shell environment. Existing private TEST folders are required; only synthetic
//                   photos are created there. Nothing is deleted; production folders are never used for writing.
// Secrets are never printed. The Supabase side is the throwaway stack (keys in .real-stack/, git-ignored).
//   bash scripts/real-stack.sh up && node scripts/real-stack-proxy.mjs &      # proxy on :5057 (as in `real-stack.sh test`)
//   node scripts/drive-integration-test.mjs --google=fake
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { runSync } from "../functions/_lib/sync.js";
import { handle } from "../functions/_lib/handler.js";
import { refreshAccessToken } from "../functions/_lib/drive.js";
import { makeWorld } from "../test-drive/fakes.mjs";

const live = (process.argv.find((a) => a.startsWith("--google=")) || "--google=fake").endsWith("live");
const URL_ = process.env.REAL_URL || "http://127.0.0.1:5057";
// This test DELETES rows and creates photos: it only ever talks to the disposable local stack.
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL_)) { console.error("REFUS: ce test n'agit que sur la pile jetable locale (127.0.0.1)."); process.exit(2); }
const read = (f) => readFileSync(new URL(`../.real-stack/${f}`, import.meta.url), "utf8").trim();
let ANON, SERVICE, ADMIN_JWT, USER_JWT;
try { ANON = read("anon.key"); SERVICE = read("service.key"); ADMIN_JWT = read("admin.key"); USER_JWT = read("user.key"); }
catch { console.error("NON TESTÉ: pile locale absente (bash scripts/real-stack.sh up)."); process.exit(2); }
if (live) for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"])
  if (!process.env[k]) { console.error(`NON TESTÉ: ${k} absente de CETTE session (voir GUIDE_DRIVE.md, saisie sécurisée).`); process.exit(2); }

const md5Hex = (b) => createHash("md5").update(b).digest("hex");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const BASE_JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDMooormOo//9k=", "base64");
// A valid JPEG made unique by a COM segment: synthetic, not a personal photo.
const jpegWith = (label) => { const c = Buffer.from(`${label}-${randomBytes(6).toString("hex")}`); const seg = Buffer.concat([Buffer.from([0xff, 0xfe, 0, c.length + 2]), c]); return Buffer.concat([BASE_JPEG.subarray(0, 2), seg, BASE_JPEG.subarray(2)]); };

let failures = 0, n = 0;
const ok = (name, cond, extra = "") => { n++; if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };
const sb = async (path, { key = SERVICE, method = "GET", body, headers = {} } = {}) => {
  const r = await fetch(URL_ + path, { method, headers: { apikey: key, authorization: `Bearer ${key}`, ...headers }, body });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j, ok: r.ok };
};
const rpc = (name, params, key) => sb(`/rest/v1/rpc/${name}`, { key, method: "POST", body: JSON.stringify(params), headers: { "content-type": "application/json" } });
const rows = async (ids) => (await sb(`/rest/v1/photos?id=in.(${ids.join(",")})&select=id,audience,status,review_reason,drive_sync_status,drive_file_id,drive_bytes,drive_sync_error,drive_sync_attempts`)).body;
const patch = (id, data) => sb(`/rest/v1/photos?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(data), headers: { "content-type": "application/json" } });
const put = (path, bytes) => sb(`/storage/v1/object/photos/${path}`, { key: ANON, method: "POST", body: bytes, headers: { "content-type": "image/jpeg", "x-upsert": "false" } });

// ---- Google side -------------------------------------------------------------------------------------------------
const world = makeWorld({ photos: [] });
const GOOGLE_HOSTS = /^https:\/\/(oauth2\.googleapis\.com|www\.googleapis\.com)\//;
const fetchFn = live ? fetch : (url, init) => (GOOGLE_HOSTS.test(String(url)) ? world.fetch(url, init) : fetch(url, init));
let googleEnv = { GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "fake", GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || "fake", GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN || "fake" };
let folders;
if (live) {
  const token = await refreshAccessToken(fetch, googleEnv);
  const auth = { headers: { authorization: `Bearer ${token}` } };
  const rootName = process.env.DRIVE_TEST_ROOT_NAME;
  if (rootName && !rootName.startsWith("TEST - ")) throw new Error("DRIVE_TEST_ROOT_NAME doit désigner un dossier TEST, jamais la production.");
  const find = async (name, parent, optional = false) => {
    const escaped = name.replaceAll("'", "\\'");
    const q = `name='${escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parent ? ` and '${parent}' in parents` : ""}`;
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?fields=nextPageToken,files(id,name,ownedByMe,shared)&pageSize=100&q=${encodeURIComponent(q)}`, auth);
    if (!response.ok) throw new Error(`Lecture Drive impossible pour « ${name} » (HTTP ${response.status}).`);
    const result = await response.json();
    if (optional && !result.nextPageToken && result.files?.length === 0) return null;
    if (result.nextPageToken || result.files?.length !== 1) throw new Error(`Dossier « ${name} » absent ou ambigu : aucun dossier ne sera créé.`);
    const folder = result.files[0];
    if (!folder.ownedByMe || folder.shared) throw new Error(`Dossier « ${name} » non privé ou non possédé : test interrompu.`);
    return folder.id;
  };
  const root = rootName ? await find(rootName) : (await find("TEST - Mariage (sync)", undefined, true)) || (await find("TEST - Mariage"));
  const pub = await find("Photos publiques", root);
  const priv = await find("Photos privées - Mariés uniquement", root);
  folders = { root, pub, priv };
  console.log(`Google : API RÉELLE — dossiers de TEST existants réutilisés (aucune création) : racine=${root} publics=${pub} privés=${priv}`);
} else { folders = { root: "t-root", pub: "folder-public", priv: "folder-private" }; console.log("Google : SIMULÉ localement (aucun appel réseau vers Google)"); }
console.log(`Supabase : pile locale RÉELLE (Storage API + PostgREST + PostgreSQL) sur ${URL_}\n`);
const ENV = (extra = {}) => ({ SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_PUBLISHABLE_KEY: ANON, ...googleEnv, DRIVE_FOLDER_PUBLIC: folders.pub, DRIVE_FOLDER_PRIVATE: folders.priv, DRIVE_SYNC_ENABLED: "true", SYNC_SECRET: randomBytes(24).toString("hex"), ...extra });
const deps = { fetchFn, md5Hex };
const drive = async (token, path) => (await fetch(`https://www.googleapis.com/drive/v3/${path}`, { headers: { authorization: `Bearer ${token}` } })).json();
const driveFiles = async (photoId) => {
  if (!live) return [...world.drive.values()].filter((f) => f.appProperties.photoId === photoId).map((f) => ({ id: f.id, parents: f.parents, size: String(f.bytes.length), md5Checksum: md5Hex(f.bytes), shared: false, permissions: [{ role: "owner", type: "user" }] }));
  const token = await refreshAccessToken(fetch, googleEnv);
  const q = encodeURIComponent(`appProperties has { key='photoId' and value='${photoId}' } and trashed=false`);
  const list = await drive(token, `files?q=${q}&fields=files(id,parents,size,md5Checksum,shared,permissions(role,type))`);
  return list.files || [];
};

// ---- 0. empty queue / nothing to do ---------------------------------------------------------------------------------
await sb("/rest/v1/photos?id=gt.00000000-0000-0000-0000-000000000000", { method: "DELETE" }); // disposable stack only
const e0 = ENV();
const idle = await runSync(e0, deps);
ok("file vide : exécution sans appel à Google", idle.ok && idle.idle === true && idle.claimed === 0);

// ---- 1. two guest uploads, exactly like the site does (anon key, Storage API, register_photo) -----------------------
const mk = async (audience, nsfw, label) => {
  const id = randomUUID(), full = jpegWith(label), thumb = jpegWith(label + "-t");
  const a = await put(`${audience}/thumbs/${id}.jpg`, thumb), b = await put(`${audience}/full/${id}.jpg`, full);
  const r = await rpc("register_photo", { p_id: id, p_audience: audience, p_sha256: sha(full), p_uploader: randomUUID(), p_nsfw: nsfw }, ANON);
  return { id, audience, full, upload: a.ok && b.ok, result: r.body?.result };
};
const A = await mk("public", "clean", "photo-A-publique"), B = await mk("maries", "skipped", "photo-B-maries");
ok("photo A (publique) : dépôt Storage + register_photo", A.upload && A.result === "published", A.result);
ok("photo B (mariés) : dépôt Storage + register_photo", B.upload && B.result === "published", B.result);
let st = await rows([A.id, B.id]);
ok("les 2 photos démarrent en 'pending' (file d'attente)", st.every((r) => r.drive_sync_status === "pending"));
const gallery = await rpc("gallery_page", { p_limit: 50 }, ANON);
ok("galerie publique : A visible, B jamais", gallery.body.some((r) => r.id === A.id) && !gallery.body.some((r) => r.id === B.id));
const signB = await sb(`/storage/v1/object/sign/photos/maries/full/${B.id}.jpg`, { key: ANON, method: "POST", body: JSON.stringify({ expiresIn: 60 }), headers: { "content-type": "application/json" } });
ok("accès non autorisé : un invité ne peut pas obtenir de lien vers la photo B", signB.status >= 400, `HTTP ${signB.status}`);

// ---- 2. endpoint permissions & kill switch (real PostgREST is_admin) --------------------------------------------------
const post = (headers, env) => handle(new Request("https://site.test/api/drive-sync", { method: "POST", headers, body: "{}" }), env, deps);
const e1 = ENV();
ok("DRIVE_SYNC_ENABLED=false : 503 et rien n'est touché", (await post({ "x-sync-secret": e1.SYNC_SECRET }, { ...e1, DRIVE_SYNC_ENABLED: "false" })).status === 503 && (await rows([A.id, B.id])).every((r) => r.drive_sync_status === "pending"));
ok("sans identifiants : 401", (await post({}, e1)).status === 401);
ok("mauvais secret : 401", (await post({ "x-sync-secret": "x".repeat(48) }, e1)).status === 401);
ok("session d'un utilisateur NON admin (JWT réel) : 401", (await post({ authorization: `Bearer ${USER_JWT}` }, e1)).status === 401);
ok("clé publique anon seule : 401", (await post({ authorization: `Bearer ${ANON}` }, e1)).status === 401);

// ---- 3. real sync: both photos, as an administrator would trigger it -----------------------------------------------
const run1 = await post({ authorization: `Bearer ${ADMIN_JWT}` }, e1);
const r1 = await run1.json();
ok("synchronisation déclenchée par un administrateur (JWT réel, is_admin via PostgREST)", run1.status === 200 && r1.ok && r1.claimed === 2 && r1.transferred === 2 && r1.failed === 0, JSON.stringify(r1));
st = await rows([A.id, B.id]); const byId = Object.fromEntries(st.map((r) => [r.id, r]));
ok("A : statut transferred, drive_file_id et taille enregistrés", byId[A.id].drive_sync_status === "transferred" && !!byId[A.id].drive_file_id && byId[A.id].drive_bytes === A.full.length);
ok("B : statut transferred, drive_file_id et taille enregistrés", byId[B.id].drive_sync_status === "transferred" && !!byId[B.id].drive_file_id && byId[B.id].drive_bytes === B.full.length);
ok("modération inchangée : A published/public, B published/maries, aucune raison ajoutée", byId[A.id].status === "published" && byId[A.id].audience === "public" && byId[B.id].status === "published" && byId[B.id].audience === "maries" && !byId[A.id].review_reason && !byId[B.id].review_reason);
const [fa, fb] = [await driveFiles(A.id), await driveFiles(B.id)];
ok("Drive : A est dans le dossier PUBLIC, une seule fois, taille et MD5 exacts", fa.length === 1 && fa[0].parents?.[0] === folders.pub && Number(fa[0].size) === A.full.length && fa[0].md5Checksum === md5Hex(A.full));
ok("Drive : B est UNIQUEMENT dans le dossier PRIVÉ, taille et MD5 exacts", fb.length === 1 && fb[0].parents?.[0] === folders.priv && !fb[0].parents.includes(folders.pub) && Number(fb[0].size) === B.full.length && fb[0].md5Checksum === md5Hex(B.full));
ok("Drive : fichiers non partagés (aucune permission publique ou 'anyone')", [...fa, ...fb].every((f) => !f.shared && !(f.permissions || []).some((p) => p.type === "anyone" || p.type === "domain")));
const stillA = await sb(`/storage/v1/object/photos/public/full/${A.id}.jpg`), stillB = await sb(`/storage/v1/object/photos/maries/full/${B.id}.jpg`);
ok("Supabase conserve les fichiers sources (aucune suppression)", stillA.status === 200 && stillB.status === 200 && stillA.body.length > 0);

// ---- 4. empty queue again, retry without duplicate ------------------------------------------------------------------
ok("2e exécution : file vide (aucun nouveau transfert)", (await runSync(e1, deps)).idle === true);
await patch(A.id, { drive_sync_status: "pending", drive_sync_attempts: 0 });
const rr = await runSync(e1, deps);
ok("relance d'une photo déjà copiée : pas de doublon sur Drive", rr.transferred === 1 && (await driveFiles(A.id)).length === 1);

// ---- 5. Google Drive unavailable (invalid token): nothing lost, nothing marked failed -----------------------------
await patch(A.id, { drive_sync_status: "pending", drive_sync_attempts: 0 });
if (!live) world.tokenStatus = 400; // the real Google rejects an invalid token by itself; the imitation must be told
const bad = await runSync(ENV({ GOOGLE_REFRESH_TOKEN: "jeton-invalide-de-test" }), deps);
world.tokenStatus = 200;
st = await rows([A.id]);
ok("Drive injoignable / jeton invalide : erreur drive_auth, photo restée en file, source conservée", bad.ok === false && bad.error === "drive_auth" && st[0].drive_sync_status === "pending" && (await sb(`/storage/v1/object/photos/public/full/${A.id}.jpg`)).status === 200, bad.error);
ok("…et la vraie connexion Google fonctionne toujours ensuite (jeton non touché)", (await runSync(e1, deps)).transferred === 1);

// ---- 6. temporary Supabase Storage outage (real container stopped), then recovery ------------------------------------
if (process.argv.includes("--with-docker-outage")) {
  await patch(B.id, { drive_sync_status: "pending", drive_sync_attempts: 0 });
  // `docker pause` freezes the real Storage container: it accepts connections but never answers (the worst case).
  execFileSync("docker", ["pause", "wreal-st"], { stdio: "ignore" });
  let down;
  try { down = await runSync(ENV({ DRIVE_FETCH_TIMEOUT_MS: "3000" }), deps); } finally { execFileSync("docker", ["unpause", "wreal-st"], { stdio: "ignore" }); }
  await new Promise((r) => setTimeout(r, 1500));
  st = await rows([B.id]);
  ok("Supabase Storage gelé (ne répond plus) : la photo passe en 'failed' au bout du délai, aucun fichier Drive en double", down.failed === 1 && st[0].drive_sync_status === "failed" && (await driveFiles(B.id)).length === 1, st[0].drive_sync_error);
  await patch(B.id, { drive_locked_at: new Date(Date.now() - 3600e3).toISOString() });
  const back = await runSync(e1, deps);
  st = await rows([B.id]);
  ok("reprise automatique après la panne (délai écoulé) : transferred, toujours 1 seul fichier Drive", back.transferred === 1 && st[0].drive_sync_status === "transferred" && (await driveFiles(B.id)).length === 1);
} else console.log("SKIP  Storage gelé (ajouter --with-docker-outage : met en pause puis relance le conteneur jetable wreal-st)");

// ---- 7. final state ---------------------------------------------------------------------------------------------------
const stats = await rpc("admin_drive_status", {}, ADMIN_JWT);
ok("compteurs d'administration (admin_drive_status, JWT admin réel)", stats.body.transferred === 2 && stats.body.failed === 0 && stats.body.pending === 0, JSON.stringify(stats.body));
const denied = await rpc("admin_drive_status", {}, USER_JWT);
ok("compteurs d'administration refusés à un utilisateur non admin", denied.status >= 400);
console.log(`\nIdentifiants Drive des fichiers de test (non secrets) : A=${byId[A.id].drive_file_id} B=${byId[B.id].drive_file_id}`);
console.log(`RÉSULTAT : ${n - failures}/${n} PASS${failures ? `, ${failures} FAIL` : ""} — Google ${live ? "RÉEL" : "SIMULÉ"}, Supabase pile locale réelle`);
process.exit(failures ? 1 : 0);
