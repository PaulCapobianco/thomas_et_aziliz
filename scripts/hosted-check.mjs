// Séance 2 : vérifications contre le projet Supabase HÉBERGÉ, avec la seule clé publique de .env.local.
//   node scripts/hosted-check.mjs --hosted
// Écrit quelques JPEG de 8x8 px dans le bucket "photos" et des lignes dans public.photos / photo_reports
// (via les RPC publiques). Ne supprime rien, ne modifie aucune configuration. Liste les chemins déposés à la fin.
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

if (!process.argv.includes("--hosted")) {
  console.error("NON_TESTÉ: relancer avec --hosted (ce script écrit sur le projet distant de .env.local).");
  process.exit(2);
}
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL_ = env.SUPABASE_URL, KEY = env.SUPABASE_ANON_KEY;
if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(URL_ || "")) { console.error("URL invalide"); process.exit(2); }
// Contrôle du rôle AVANT tout appel.
let role;
if (KEY?.startsWith("sb_publishable_")) role = "anon (clé publishable)";
else if (KEY?.startsWith("sb_secret_")) role = "secret";
else if (KEY?.split(".").length === 3) role = JSON.parse(Buffer.from(KEY.split(".")[1], "base64url")).role;
if (!(role === "anon" || role?.startsWith("anon "))) {
  console.error(`ARRÊT: la clé n'est pas une clé publique anon (rôle détecté: ${role ?? "inconnu"}).`);
  process.exit(3);
}
console.log(`Clé vérifiée: rôle ${role}. Projet: ${URL_}`);

const sb = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const bucket = sb.storage.from("photos");
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDMooormOo//9k=", "base64");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const results = [], deposited = [], rows = [];
const check = (id, name, pass, detail = "") => {
  results.push({ id, name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${id} ${name}${detail ? ` — ${detail}` : ""}`);
};
const msg = (e) => (e ? `${e.statusCode ?? e.status ?? e.code ?? ""} ${e.message}`.trim() : "");
const refused = (r) => !!r.error || (Array.isArray(r.data) && r.data.every((x) => !x.signedUrl));
const paths = (id, aud) => [`${aud}/thumbs/${id}.jpg`, `${aud}/full/${id}.jpg`];
const run = randomUUID();
const uploader = randomUUID();

async function put(path, body = JPEG, contentType = "image/jpeg") {
  const r = await bucket.upload(path, body, { contentType, upsert: false });
  if (!r.error) deposited.push(path);
  return r;
}
async function send(aud, nsfw, seed = randomUUID()) {
  const id = randomUUID();
  const body = Buffer.concat([JPEG, Buffer.from(`${run}:${seed}`)]);
  const up = [await put(paths(id, aud)[0], body), await put(paths(id, aud)[1], body)];
  const reg = await sb.rpc("register_photo", { p_id: id, p_audience: aud, p_sha256: sha(body), p_uploader: uploader, p_nsfw: nsfw });
  if (!reg.error) rows.push(id);
  return { id, body, seed, up, reg };
}
const inGallery = async (id) => {
  const g = await sb.rpc("gallery_page", { p_limit: 100 });
  return { error: g.error, found: !!g.data?.some((r) => r.id === id) };
};

// ---- 7. projet actif + migrations présentes ---------------------------------------------------
{
  // La racine REST répond 401 aux clés publishable : on interroge une RPC (une erreur PostgREST JSON prouve que le projet répond).
  const probe = await sb.rpc("check_duplicates", { p_audience: "public", p_hashes: [] });
  const alive = probe.error ? typeof probe.error.code === "string" && probe.error.code.length > 0 : true;
  check("7a", "projet actif (l'API répond, non en pause)", alive, probe.error ? msg(probe.error) : "OK");
  console.log("NON_TESTÉ 7b offre / quota: non exposés par l'API publique.");
  if (probe.error?.code === "PGRST202") {
    console.log("ARRÊT: la fonction public.check_duplicates n'existe pas => migrations 0001-0003 NON appliquées sur ce projet (séance 1, étape 3). Aucune écriture effectuée.");
    process.exit(4);
  }
}

// ---- 1. Vérification n°1 A–E -----------------------------------------------------------------
const idA = randomUUID(), pathA = `public/thumbs/${idA}.jpg`;
const A = await put(pathA);
check("1A", "dépôt anonyme public/thumbs/<uuid>.jpg", !A.error, A.error ? msg(A.error) : pathA);
if (A.error) {
  console.log("ARRÊT: A a échoué. Erreur exacte ci-dessus; plan B = supabase/README.md §5 (non implémenté).");
  process.exit(1);
}
const B = await bucket.createSignedUrl(pathA, 60);
check("1B", "signature d'un fichier non enregistré refusée", !!B.error && !B.data?.signedUrl, msg(B.error));
const C = await bucket.list("public/thumbs", { limit: 1000 });
const listedPublic = (C.data ?? []).map((o) => o.name);
check("1C", "list('public/thumbs') ne révèle pas le fichier non enregistré", !listedPublic.some((n) => n.includes(idA)),
  `${listedPublic.length} entrée(s) visible(s) (photos publiées légitimes)${C.error ? " " + msg(C.error) : ""}`);
const D = await sb.rpc("check_duplicates", { p_audience: "public", p_hashes: [] });
check("1D", "rpc check_duplicates([]) => []", !D.error && Array.isArray(D.data) && D.data.length === 0, msg(D.error));
const E = await sb.rpc("admin_status");
check("1E", "rpc admin_status refusée", E.error?.code === "42501" || /permission denied/i.test(E.error?.message || ""), msg(E.error));

// ---- 2. Parcours complet ---------------------------------------------------------------------
const P = await send("public", "clean", "parcours");
check("2a", "dépôt thumb+full puis register_photo clean => published",
  P.up.every((u) => !u.error) && P.reg.data?.result === "published", JSON.stringify(P.reg.data ?? msg(P.reg.error)));
const P2 = await send("public", "clean", "parcours"); // même octets, autre uuid
check("2b", "même fichier, autre uuid => duplicate", P2.reg.data?.result === "duplicate", JSON.stringify(P2.reg.data ?? msg(P2.reg.error)));
const g = await inGallery(P.id);
check("2c", "gallery_page contient la photo", g.found, msg(g.error));
const S = await bucket.createSignedUrls(paths(P.id, "public"), 60);
check("2d", "URL signées de la photo publiée obtenues", S.data?.every((s) => s.signedUrl), msg(S.error));
for (const s of S.data ?? []) {
  const res = await fetch(s.signedUrl);
  const bytes = Buffer.from(await res.arrayBuffer());
  check("2e", `GET URL signée (${s.path.split("/")[1]}) => 200, octets identiques`, res.status === 200 && bytes.equals(P.body), `HTTP ${res.status}`);
}
const M = await send("maries", "skipped", "prive");
check("2f", "envoi destination maries accepté", M.reg.data?.result === "published" && M.up.every((u) => !u.error), JSON.stringify(M.reg.data ?? msg(M.reg.error)));
check("2g", "signature thumb/full maries refusée", refused(await bucket.createSignedUrls(paths(M.id, "maries"), 60)));
check("2h", "photo maries absente de gallery_page", !(await inGallery(M.id)).found);

// ---- 3. Suspecte -----------------------------------------------------------------------------
const X = await send("public", "suspect", "suspect");
check("3a", "p_nsfw suspect => pending_review", X.reg.data?.result === "pending_review", JSON.stringify(X.reg.data ?? msg(X.reg.error)));
check("3b", "absente de gallery_page", !(await inGallery(X.id)).found);
check("3c", "signature refusée", refused(await bucket.createSignedUrls(paths(X.id, "public"), 60)));

// ---- 4. Signalements -------------------------------------------------------------------------
const R = await send("public", "clean", "signalements");
const rep = (photo, reporter) => sb.rpc("report_photo", { p_photo_id: photo, p_reporter: reporter, p_reason: "other" });
const v1 = randomUUID(), v2 = randomUUID();
const r1 = await rep(R.id, v1);
check("4a", "1 vote ne masque pas", r1.data?.result === "reported" && (await inGallery(R.id)).found, JSON.stringify(r1.data ?? msg(r1.error)));
const r1b = await rep(R.id, v1);
check("4b", "même reporter_id deux fois => already_reported", r1b.data?.result === "already_reported", JSON.stringify(r1b.data ?? msg(r1b.error)));
const r2 = await rep(R.id, v2);
check("4c", "2e vote d'un reporter_id différent => reported puis masquée",
  r2.data?.result === "reported" && !(await inGallery(R.id)).found && refused(await bucket.createSignedUrls(paths(R.id, "public"), 60)),
  JSON.stringify(r2.data ?? msg(r2.error)));
const rp = await rep(M.id, randomUUID());
check("4d", "signaler une photo privée => not_found", rp.data?.result === "not_found", JSON.stringify(rp.data ?? msg(rp.error)));
const ri = await rep(randomUUID(), randomUUID());
check("4e", "signaler une photo inexistante => not_found", ri.data?.result === "not_found", JSON.stringify(ri.data ?? msg(ri.error)));

// ---- 5. Fuites directes ----------------------------------------------------------------------
const closed = (r) => !!r.error || (Array.isArray(r.data) && r.data.length === 0);
check("5a", "SELECT photo_reports refusé/vide", closed(await sb.from("photo_reports").select("*")));
check("5b", "SELECT app_settings refusé/vide", closed(await sb.from("app_settings").select("*")));
check("5c", "SELECT admin_users refusé/vide", closed(await sb.from("admin_users").select("*")));
for (const col of ["original_sha256", "uploader_id", "review_reason"]) {
  const r = await sb.from("photos").select(`id,${col}`).limit(1);
  check("5d", `SELECT photos.${col} refusé`, !!r.error, msg(r.error));
}
const vis = await sb.from("photos").select("id,audience,status").limit(1000);
check("5e", "SELECT photos ne montre que public+published", !vis.error && vis.data.every((r) => r.audience === "public" && r.status === "published"), msg(vis.error));
const ins = await sb.from("photos").insert({ id: randomUUID(), audience: "public", status: "published", full_path: "x", thumb_path: "y", original_sha256: "0".repeat(64), uploader_id: randomUUID() });
check("5f", "INSERT direct photos refusé", !!ins.error, msg(ins.error));
const upd = await sb.from("photos").update({ status: "published" }).eq("id", X.id).select();
const xs = await sb.rpc("gallery_page", { p_limit: 100 });
check("5g", "UPDATE direct photos sans effet (suspecte toujours masquée)", (!!upd.error || !upd.data?.length) && !xs.data?.some((r) => r.id === X.id), msg(upd.error));
const del = await sb.from("photos").delete().eq("id", P.id).select();
check("5h", "DELETE direct photos sans effet", (!!del.error || !del.data?.length) && (await inGallery(P.id)).found, msg(del.error));
const fake = await sb.from("photo_reports").insert({ photo_id: P.id, reporter_id: randomUUID() });
check("5i", "INSERT direct photo_reports refusé", !!fake.error, msg(fake.error));
for (const [fn, args] of [
  ["admin_status", {}], ["admin_orphans", {}], ["admin_list_photos", { p_filter: "recent" }],
  ["admin_set_status", { p_id: X.id, p_status: "published" }], ["admin_set_paused", { p_paused: true }],
  ["admin_release_pending", { p_reason: "model_unavailable" }],
]) {
  const r = await sb.rpc(fn, args);
  check("5j", `${fn} refusée`, r.error?.code === "42501" || /permission denied|not allowed/i.test(r.error?.message || ""), msg(r.error));
}
const ow = await bucket.upload(paths(P.id, "public")[0], JPEG, { contentType: "image/jpeg", upsert: true });
check("5k", "écrasement d'un objet existant refusé", !!ow.error, msg(ow.error));
const rm = await bucket.remove(paths(P.id, "public"));
check("5l", "suppression d'objets par la clé publique sans effet", !rm.error ? rm.data.length === 0 : true, `${rm.data?.length ?? 0} supprimé(s)`);

// ---- 6. Limites ------------------------------------------------------------------------------
const big = await put(`public/full/${randomUUID()}.jpg`, Buffer.alloc(3 * 1024 * 1024 + 1, 1));
check("6a", "fichier > 3 Mo refusé", !!big.error, msg(big.error));
const html = await put(`public/full/${randomUUID()}.jpg`, Buffer.from("<html></html>"), "text/html");
check("6b", "fichier non JPEG (text/html) refusé", !!html.error, msg(html.error));
const png = await put(`public/full/${randomUUID()}.jpg`, Buffer.from("\x89PNG\r\n\x1a\n"), "image/png");
check("6c", "fichier image/png refusé", !!png.error, msg(png.error));
const bad1 = await put("public/full/not-a-uuid.jpg");
check("6d", "chemin non conforme (nom) refusé", !!bad1.error, msg(bad1.error));
const bad2 = await put(`autre/full/${randomUUID()}.jpg`);
check("6e", "chemin hors format (dossier racine inconnu) refusé", !!bad2.error, msg(bad2.error));
const bad3 = await put(`public/inconnu/${randomUUID()}.jpg`);
check("6f", "chemin hors format (sous-dossier inconnu) refusé", !!bad3.error, msg(bad3.error));

// ---- Bilan -----------------------------------------------------------------------------------
const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} PASS, ${fails.length} FAIL`);
console.log(`\nFichiers déposés dans le bucket "photos" (${deposited.length}):`);
for (const p of deposited) console.log(`  ${p}`);
console.log(`\nLignes créées dans public.photos (${rows.length}): ${rows.join(", ")}`);
process.exitCode = fails.length ? 1 : 0;
