// Export des photos contre la pile locale RÉELLE (Storage, PostgREST, GoTrue, PostgreSQL) : aucun mock.
// Lancé par scripts/real-stack.sh après les autres tests (il ajoute plus de 250 photos en attente et des photos privées).
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { execFileSync, execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, stat, truncate, utimes } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { readZip } from "./zip-helper.js";

const { REAL_URL, REAL_ANON, REAL_ADMIN_PASSWORD, REAL_SERVICE_KEY } = process.env;
test.skip(!REAL_URL || !REAL_ANON || !REAL_ADMIN_PASSWORD, "NON TESTÉ: real stack not configured");
test.skip(({ browserName, isMobile }) => browserName !== "chromium" || isMobile, "export tests run once, on desktop Chromium");
test.use({ bypassCSP: true });
test.describe.configure({ mode: "serial" });

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const client = () => createClient(REAL_URL, REAL_ANON, { auth: { persistSession: false } });
const BASE = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDMooormOo//9k=", "base64");
const RUN = Date.now();
// Realistic weight: ~600 KB per "full" file (a valid JPEG header + random trailing bytes, unique per photo).
const fullBytes = () => Buffer.concat([BASE, randomBytes(600 * 1024)]);
const thumbBytes = () => Buffer.concat([BASE, randomBytes(40 * 1024)]);

const truth = new Map(); // id -> { audience, sha, thumbSha }
async function seed(audience, count, tag) {
  const anon = client();
  const ids = [];
  let next = 0;
  async function worker() {
    while (next < count) {
      next++;
      const id = randomUUID(), full = fullBytes(), thumb = thumbBytes();
      for (const [kind, body] of [["thumbs", thumb], ["full", full]]) {
        const up = await anon.storage.from("photos").upload(`${audience}/${kind}/${id}.jpg`, body, { contentType: "image/jpeg" });
        if (up.error) throw up.error;
      }
      const reg = await anon.rpc("register_photo", { p_id: id, p_audience: audience, p_sha256: sha(Buffer.concat([full, Buffer.from(tag + id)])), p_uploader: randomUUID(), p_nsfw: "skipped" });
      if (reg.error || !["published", "pending_review"].includes(reg.data?.result)) throw new Error(JSON.stringify(reg));
      truth.set(id, { audience, sha: sha(full), thumbSha: sha(thumb) });
      ids.push(id);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  return ids;
}
async function openAdmin(page) {
  await page.route("**/config.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: `export const NAMES='';export const DATE_TXT='';export const SUPABASE_URL='${REAL_URL}';export const SUPABASE_KEY='${REAL_ANON}';export const BUCKET='photos';export const SECRET='';export const LOCATION='';export const COUPLE_PHOTO='';export const NSFW_ENABLED=true;` }),
  );
  await page.goto(`${REAL_URL}/admin.html`);
  await page.locator("#email").fill("admin@example.test");
  await page.locator("#password").fill(REAL_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.locator("#dashboard")).toBeVisible({ timeout: 20000 });
  await page.locator("#tab-export").click();
  await expect(page.locator("#export-panel")).toBeVisible();
}
function collect(page, dir) {
  const saved = [];
  page.on("download", (d) => saved.push(d.saveAs(join(dir, d.suggestedFilename())).then(() => join(dir, d.suggestedFilename()))));
  return async () => { await page.waitForTimeout(500); return Promise.all(saved); };
}

let mariesIds, publicIds;
const adminClient = async () => {
  const c = client();
  expect((await c.auth.signInWithPassword({ email: "admin@example.test", password: REAL_ADMIN_PASSWORD })).error).toBeNull();
  return c;
};
test.beforeAll(async () => {
  test.setTimeout(300000);
  // Rows left by earlier tests whose files were deleted on purpose (the disposable database is shared): remove them as an admin,
  // so that "Export complet" below is about this test's own photos. A missing file is covered by its own test further down.
  const admin = await adminClient();
  for (const filter of ["maries", "recent"]) {
    const rows = (await admin.rpc("admin_list_photos", { p_filter: filter, p_limit: 200, p_offset: 0 })).data ?? [];
    for (let offset = 200; rows.length === offset; offset += 200)
      rows.push(...((await admin.rpc("admin_list_photos", { p_filter: filter, p_limit: 200, p_offset: offset })).data ?? []));
    const signed = (await admin.storage.from("photos").createSignedUrls(rows.map((r) => r.full_path), 60)).data ?? [];
    for (const [i, row] of rows.entries()) if (!signed[i]?.signedUrl) await admin.rpc("admin_set_status", { p_id: row.id, p_status: "deleted" });
  }
  mariesIds = await seed("maries", 5, `m${RUN}`);
  publicIds = await seed("public", 255, `p${RUN}`); // pending (never published by register_photo): the gallery of the other tests is untouched
});

test("non-admins (anonymous and a connected guest account) can neither list nor download private photos; the admin can", async () => {
  const anon = client();
  const user = client();
  expect((await user.auth.signInWithPassword({ email: "invite@example.test", password: REAL_ADMIN_PASSWORD })).error).toBeNull();
  const admin = client();
  expect((await admin.auth.signInWithPassword({ email: "admin@example.test", password: REAL_ADMIN_PASSWORD })).error).toBeNull();
  const sample = mariesIds[0];
  const paths = [`maries/full/${sample}.jpg`, `maries/thumbs/${sample}.jpg`];
  for (const [who, c] of [["anonymous", anon], ["guest account", user]]) {
    for (const filter of ["maries", "recent", "pending", "hidden"]) {
      const r = await c.rpc("admin_list_photos", { p_filter: filter, p_limit: 5, p_offset: 0 });
      expect(r.error?.code, `${who} list ${filter}`).toBe("42501");
      expect(r.data).toBeNull();
    }
    expect((await c.rpc("admin_status")).error?.code).toBe("42501");
    const signed = await c.storage.from("photos").createSignedUrls(paths, 60);
    expect(signed.data?.some((s) => s.signedUrl), `${who} signed URL of a private photo`).toBeFalsy();
    expect((await c.storage.from("photos").download(paths[0])).error, `${who} direct download`).not.toBeNull();
    expect((await c.storage.from("photos").list("maries/full", { limit: 100 })).data ?? []).toHaveLength(0);
  }
  const listed = await admin.rpc("admin_list_photos", { p_filter: "maries", p_limit: 200, p_offset: 0 });
  expect(listed.data.filter((r) => mariesIds.includes(r.id)).length).toBe(5);
  const signed = await admin.storage.from("photos").createSignedUrls(paths, 60);
  expect(signed.data.every((s) => s.signedUrl)).toBe(true);
});

test("the export tab of a connected non-admin account is refused (dashboard never shows)", async ({ page }) => {
  await page.route("**/config.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: `export const NAMES='';export const DATE_TXT='';export const SUPABASE_URL='${REAL_URL}';export const SUPABASE_KEY='${REAL_ANON}';export const BUCKET='photos';export const SECRET='';export const LOCATION='';export const COUPLE_PHOTO='';export const NSFW_ENABLED=true;` }),
  );
  await page.goto(`${REAL_URL}/admin.html`);
  await page.locator("#email").fill("invite@example.test");
  await page.locator("#password").fill(REAL_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.locator("#admin-message")).toContainText("n’a pas accès à l’administration", { timeout: 20000 });
  await expect(page.locator("#dashboard")).toBeHidden();
  await expect(page.locator("#tab-export")).toBeHidden();
});

test("private folder end to end: real signed URLs, ZIP opened, every SHA-256 equals the bytes that were uploaded", async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const dir = testInfo.outputPath("zips");
  await openAdmin(page);
  await page.locator("#export-st-pending").uncheck();
  const files = collect(page, dir);
  await expect(page.locator("#export-count-maries")).toContainText("photos à exporter");
  const expected = Number((await page.locator("#export-count-maries").textContent()).split(" ")[0]);
  expect(expected).toBeGreaterThanOrEqual(5);
  await page.locator("#export-btn-maries").click();
  await expect(page.locator("#export-summary")).toHaveText(`Export complet : ${expected} photos sur ${expected}.`, { timeout: 90000 });
  const [zipPath] = await files();
  const z = readZip(zipPath);
  expect(z.bad).toBeNull();
  expect(z.files.every((f) => f.method === 0)).toBe(true);
  const rows = z.files.find((f) => f.name === "index.csv").text.trim().split("\r\n").slice(1).map((l) => l.split(","));
  expect(rows.length).toBe(expected);
  let checked = 0;
  for (const row of rows) {
    const t = truth.get(row[1]);
    expect(row[3]).toBe("maries");
    const entry = z.files.find((f) => f.name === row[0]);
    expect(entry.sha256).toBe(row[7]);
    if (t) { expect(row[7]).toBe(t.sha); checked++; }
  }
  expect(checked).toBe(5);
});

test("250+ photos: archives of 100, 100, then the rest, exact SHA-256 of every file, time and memory measured", async ({ page, browser }, testInfo) => {
  test.setTimeout(600000);
  const dir = testInfo.outputPath("zips250");
  await openAdmin(page);
  await page.locator("#export-st-published").uncheck();
  await expect(page.locator("#export-count-public")).toContainText(/\d+ photos à exporter/);
  const expected = Number((await page.locator("#export-count-public").textContent()).split(" ")[0]);
  expect(expected).toBeGreaterThanOrEqual(255);
  const files = collect(page, dir);
  // Memory: JS heap of the page (CDP) and resident memory of the renderer process, sampled every 250 ms.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const bcdp = await browser.newBrowserCDPSession();
  let peakHeap = 0, peakRss = 0;
  const sample = async () => {
    const m = (await cdp.send("Performance.getMetrics")).metrics.find((x) => x.name === "JSHeapUsedSize")?.value ?? 0;
    peakHeap = Math.max(peakHeap, m);
    try {
      const info = (await bcdp.send("SystemInfo.getProcessInfo")).processInfo.filter((p) => p.type === "renderer");
      for (const p of info) {
        const kb = Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${p.id}/status`, "utf8"))?.[1] ?? 0);
        peakRss = Math.max(peakRss, kb * 1024);
      }
    } catch { /* RSS is best effort */ }
  };
  const timer = setInterval(() => sample().catch(() => {}), 250);
  const t0 = Date.now();
  await page.locator("#export-btn-public").click();
  await expect(page.locator("#export-label")).toContainText("Lot 1 sur", { timeout: 30000 });
  await expect(page.locator("#export-summary")).toHaveText(`Export complet : ${expected} photos sur ${expected}.`, { timeout: 540000 });
  const seconds = (Date.now() - t0) / 1000;
  clearInterval(timer);
  await sample();
  const zips = await files();
  const names = zips.map((p) => p.split("/").at(-1));
  expect(names.slice(0, 3)).toEqual(["mariage-public-lot-01.zip", "mariage-public-lot-02.zip", "mariage-public-lot-03.zip"]);
  const counts = [];
  let verified = 0;
  for (const zipPath of zips) {
    const z = readZip(zipPath);
    expect(z.bad).toBeNull();
    const jpgs = z.files.filter((f) => f.name.endsWith(".jpg"));
    counts.push(jpgs.length);
    expect(jpgs.length).toBeLessThanOrEqual(100);
    const rows = z.files.find((f) => f.name === "index.csv").text.trim().split("\r\n").slice(1).map((l) => l.split(","));
    expect(rows.length).toBe(jpgs.length);
    for (const row of rows) {
      const entry = jpgs.find((f) => f.name === row[0]);
      expect(entry.sha256).toBe(row[7]);
      const t = truth.get(row[1]);
      if (t) { expect(row[7]).toBe(t.sha); verified++; }
      expect(row[4]).toBe("pending_review");
    }
  }
  expect(counts.reduce((a, b) => a + b, 0)).toBe(expected);
  expect(counts.slice(0, 2)).toEqual([100, 100]);
  expect(verified).toBe(255);
  const mb = (n) => `${(n / 1048576).toFixed(0)} MB`;
  const report = `EXPORT 250+ : ${expected} photos in ${seconds.toFixed(1)} s (${(expected / seconds).toFixed(1)} photos/s), ${counts.length} archives ${JSON.stringify(counts)}, peak JS heap ${mb(peakHeap)}, peak renderer RSS ${mb(peakRss)}, data ${mb(expected * 640 * 1024)}`;
  console.log(report);
  testInfo.annotations.push({ type: "export-250", description: report });
  expect(peakHeap).toBeLessThan(150 * 1048576); // photos are never accumulated in the JS heap
});

const run = promisify(execFile);
const script = (out, extra = [], env = {}) =>
  run("node", ["scripts/export-photos.mjs", "--out", out, ...extra], { env: { ...process.env, SUPABASE_URL: REAL_URL, SUPABASE_PUBLISHABLE_KEY: REAL_ANON, EXPORT_ADMIN_EMAIL: "admin@example.test", EXPORT_ADMIN_PASSWORD: REAL_ADMIN_PASSWORD, ...env }, maxBuffer: 1 << 26 }).then(
    (r) => ({ code: 0, ...r }),
    (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }),
  );

test("local backup script: both folders, full + thumbnails, exact SHA-256, resumable, repairs a damaged file, refuses a non-admin and a secret key", async ({}, testInfo) => {
  test.setTimeout(600000);
  const out = await mkdtemp(join(tmpdir(), "export-photos-"));
  const first = await script(out);
  expect(first.code, first.stdout + first.stderr).toBe(0);
  expect(first.stdout).toContain("Export complet");
  expect(first.stdout).not.toContain("INCOMPLET");
  for (const folder of ["public", "maries"]) {
    const index = (await readFile(join(out, folder, "index.csv"), "utf8")).trim().split("\r\n");
    const rows = index.slice(1).map((l) => l.split(","));
    const full = await readdir(join(out, folder, "full"));
    const thumbs = await readdir(join(out, folder, "thumbs"));
    expect(full.length).toBe(rows.length);
    expect(thumbs.length).toBe(rows.length);
    let known = 0;
    for (const r of rows) {
      const bytes = await readFile(join(out, folder, "full", r[0]));
      expect(sha(bytes)).toBe(r[8]);
      expect(bytes.length).toBe(Number(r[7]));
      expect(sha(await readFile(join(out, folder, "thumbs", r[1])))).toBe(r[10]);
      const t = truth.get(r[2]);
      if (t) { expect(r[8]).toBe(t.sha); expect(r[10]).toBe(t.thumbSha); known++; }
    }
    expect(known).toBe(folder === "public" ? 255 : 5);
  }
  // Second run: nothing is downloaded again (files untouched), still complete.
  const probe = join(out, "maries", "full", (await readdir(join(out, "maries", "full")))[0]);
  const old = new Date(2020, 0, 1);
  await utimes(probe, old, old);
  const second = await script(out, ["--folders", "maries"]);
  expect(second.code, second.stdout + second.stderr).toBe(0);
  expect(second.stdout).toContain("déjà présentes");
  expect((await stat(probe)).mtimeMs).toBe(old.getTime());
  // A truncated file is detected (size differs) and downloaded again.
  const intact = (await stat(probe)).size;
  expect(intact).toBeGreaterThan(100);
  await truncate(probe, 100);
  const third = await script(out, ["--folders", "maries"]);
  expect(third.code, third.stdout + third.stderr).toBe(0);
  expect((await stat(probe)).size).toBe(intact);
  // A guest account (not an administrator) gets nothing; a secret key is refused before any request.
  const guest = await script(await mkdtemp(join(tmpdir(), "export-photos-")), [], { EXPORT_ADMIN_EMAIL: "invite@example.test" });
  expect(guest.code).toBe(1);
  expect(guest.stderr).toContain("n'est pas administrateur");
  const secret = await script(await mkdtemp(join(tmpdir(), "export-photos-")), [], { SUPABASE_PUBLISHABLE_KEY: REAL_SERVICE_KEY });
  expect(secret.code).toBe(2);
  expect(secret.stderr).toContain("clé secrète");
});

test("a photo whose file is missing is reported (not exported, listed with the reason), without blocking the others", async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const [victim] = await seed("maries", 1, `x${RUN}`);
  const admin = await adminClient();
  expect((await admin.storage.from("photos").remove([`maries/full/${victim}.jpg`])).error).toBeNull();
  await openAdmin(page);
  await page.locator("#export-st-pending").uncheck();
  const files = collect(page, testInfo.outputPath("zips-missing"));
  await page.locator("#export-btn-maries").click();
  await expect(page.locator("#export-summary")).toContainText("Export incomplet", { timeout: 90000 });
  await expect(page.locator("#export-failures")).toContainText(`Manquante : ${victim.slice(0, 8)} (fichier introuvable)`);
  await expect(page.locator("#export-retry")).toBeVisible();
  const [zipPath] = await files();
  const [, done, of] = (await page.locator("#export-summary").textContent()).match(/: (\d+) photos sur (\d+)/).map(Number);
  expect(of - done).toBe(1);
  expect(readZip(zipPath).files.filter((f) => f.name.endsWith(".jpg")).length).toBe(done);
  await admin.rpc("admin_set_status", { p_id: victim, p_status: "deleted" });
});
