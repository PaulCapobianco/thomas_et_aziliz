#!/usr/bin/env node
// Sauvegarde complète des photos (grandes + miniatures), dossier par dossier, avec index.csv et sommes SHA-256.
// Rôle : administrateur (compte de public.admin_users). N'utilise JAMAIS la clé service_role : seulement la clé publique + votre connexion.
// Relançable : un fichier déjà présent, de la bonne taille, n'est pas retéléchargé. Voir EXPORT_PHOTOS.md.
//
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_PUBLISHABLE_KEY=sb_publishable_... node scripts/export-photos.mjs [--out DOSSIER]
//        [--folders public,maries] [--status published,pending_review,hidden] [--no-thumbs]
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!URL_ || !KEY) {
  console.error("Définissez SUPABASE_URL et SUPABASE_PUBLISHABLE_KEY (clé publique, jamais la clé secrète).");
  process.exit(2);
}
if (KEY.startsWith("sb_secret_") || (KEY.split(".").length === 3 && JSON.parse(Buffer.from(KEY.split(".")[1], "base64url")).role === "service_role")) {
  console.error("Cette clé est une clé secrète (service_role) : refusée. Utilisez la clé publique.");
  process.exit(2);
}
const out = resolve(opt("out", "sauvegarde-photos"));
const folders = opt("folders", "public,maries").split(",").map((s) => s.trim()).filter(Boolean);
const statuses = new Set(opt("status", "published,pending_review,hidden").split(",").map((s) => s.trim()));
const withThumbs = !args.includes("--no-thumbs");
const BUCKET = "photos";
const FILTER = { public: "recent", maries: "maries" };
for (const f of folders) if (!FILTER[f]) {
  console.error(`Dossier inconnu : ${f} (public ou maries)`);
  process.exit(2);
}

function ask(question, hidden = false) {
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (text) => {
        if (text.includes(question)) process.stdout.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      done(answer);
    });
  });
}
// Identifiants : demandés ici, jamais écrits dans un fichier. (Variables EXPORT_ADMIN_EMAIL / EXPORT_ADMIN_PASSWORD acceptées pour les tests automatisés.)
const email = process.env.EXPORT_ADMIN_EMAIL || (await ask("E-mail administrateur : "));
const password = process.env.EXPORT_ADMIN_PASSWORD || (await ask("Mot de passe : ", true));
const sb = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: true } });
const login = await sb.auth.signInWithPassword({ email: email.trim(), password });
if (login.error) {
  console.error(`Connexion refusée : ${login.error.message}`);
  process.exit(1);
}
const adminCheck = await sb.rpc("admin_status");
if (adminCheck.error) {
  console.error("Ce compte est connecté mais n'est pas administrateur : aucune photo ne peut être exportée.");
  process.exit(1);
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const stamp = (row) => new Date(row.created_at).toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "T") + "Z";
const fileName = (row) => `${stamp(row)}_${row.id}.jpg`;
const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csvCell = (v) => (/[",\r\n]/.test(String(v ?? "")) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ""));

async function list(folder) {
  const rows = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await sb.rpc("admin_list_photos", { p_filter: FILTER[folder], p_limit: 200, p_offset: offset });
    if (error) throw error;
    rows.push(...data.filter((r) => r.audience === folder));
    if (data.length < 200) break;
  }
  return rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id.localeCompare(b.id));
}
async function signedUrl(path) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error(error?.message || "lien signé indisponible");
  return data.signedUrl;
}
// Télécharge (ou reprend) un fichier ; renvoie { size, sha256, reused }.
async function fetchFile(path, target) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const url = await signedUrl(path);
      const head = await fetch(url, { method: "HEAD" });
      if (!head.ok) throw new Error(`HTTP ${head.status}`);
      const expected = Number(head.headers.get("content-length"));
      const existing = await stat(target).catch(() => null);
      if (existing && expected && existing.size === expected) {
        const bytes = await readFile(target);
        if (isJpeg(bytes)) return { size: bytes.length, sha256: sha256(bytes), reused: true };
      }
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (expected && bytes.length !== expected) throw new Error(`taille reçue ${bytes.length} ≠ annoncée ${expected}`);
      if (!isJpeg(bytes)) throw new Error("ce n'est pas un JPEG");
      await writeFile(`${target}.part`, bytes);
      await rename(`${target}.part`, target);
      return { size: bytes.length, sha256: sha256(bytes), reused: false };
    } catch (error) {
      last = error;
      await sleep(500 * (attempt + 1));
    }
  }
  throw last;
}

let problems = 0;
for (const folder of folders) {
  const dir = join(out, folder);
  await mkdir(join(dir, "full"), { recursive: true });
  if (withThumbs) await mkdir(join(dir, "thumbs"), { recursive: true });
  const rows = (await list(folder)).filter((r) => statuses.has(r.status));
  console.log(`\n=== ${folder === "public" ? "Galerie commune" : "Uniquement aux mariés"} : ${rows.length} photos ===`);
  const index = [];
  const failed = [];
  let n = 0;
  for (const row of rows) {
    n++;
    const name = fileName(row);
    try {
      const full = await fetchFile(row.full_path, join(dir, "full", name));
      const thumb = withThumbs ? await fetchFile(row.thumb_path, join(dir, "thumbs", name)) : null;
      index.push({ row, name, full, thumb });
      process.stdout.write(`\r${n}/${rows.length}${full.reused && (!thumb || thumb.reused) ? " (déjà présente)" : ""}        `);
    } catch (error) {
      failed.push({ row, reason: error.message });
      process.stdout.write(`\r${n}/${rows.length} — ÉCHEC ${row.id.slice(0, 8)} : ${error.message}\n`);
    }
  }
  process.stdout.write("\n");
  const header = ["fichier", "fichier_miniature", "identifiant", "date_envoi", "audience", "statut", "raison_attente", "taille_octets", "sha256", "taille_miniature_octets", "sha256_miniature"];
  const lines = index.map(({ row, name, full, thumb }) =>
    [name, thumb ? name : "", row.id, new Date(row.created_at).toISOString(), row.audience, row.status, row.review_reason ?? "", full.size, full.sha256, thumb?.size ?? "", thumb?.sha256 ?? ""].map(csvCell).join(","),
  );
  await writeFile(join(dir, "index.csv"), `${header.join(",")}\r\n${lines.join("\r\n")}${lines.length ? "\r\n" : ""}`);
  // Vérification finale : relecture de CHAQUE fichier sur le disque, comparée à l'index (taille et SHA-256).
  let gaps = 0;
  for (const { name, full, thumb } of index) {
    for (const [kind, expected] of [["full", full], ["thumbs", thumb]]) {
      if (!expected) continue;
      const bytes = await readFile(join(dir, kind, name)).catch(() => null);
      if (!bytes || bytes.length !== expected.size || sha256(bytes) !== expected.sha256) {
        gaps++;
        console.error(`Écart : ${kind}/${name}`);
      }
    }
  }
  // Comparaison avec la base à la fin de l'export.
  const after = (await list(folder)).filter((r) => statuses.has(r.status));
  const have = new Set(index.map((i) => i.row.id));
  const missing = after.filter((r) => !have.has(r.id));
  const complete = !failed.length && !gaps && !missing.length;
  console.log(
    complete
      ? `Export complet : ${index.length} photos sur ${after.length} (${index.filter((i) => i.full.reused).length} déjà présentes, vérification disque : 0 écart).`
      : `Export INCOMPLET : ${index.length} photos sur ${after.length} ; ${failed.length} échec(s), ${gaps} écart(s) disque, ${missing.length} manquante(s).`,
  );
  for (const m of missing) console.log(`  manquante : ${m.id} ${failed.find((f) => f.row.id === m.id)?.reason ?? "ajoutée pendant l'export"}`);
  if (!complete) problems++;
}
await sb.auth.signOut({ scope: "local" });
console.log(`\nDossier de sauvegarde : ${out}`);
process.exit(problems ? 1 : 0);
