// Administrator access against REAL GoTrue + PostgREST + Storage + PostgreSQL (disposable local stack, scripts/real-stack.sh).
// Real accounts, real passwords, real JWTs: nothing is mocked. Skipped unless REAL_URL is set.
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, createHash } from "node:crypto";

const { REAL_URL, REAL_ANON, REAL_ADMIN_PASSWORD, REAL_SERVICE_KEY } = process.env;
test.skip(!REAL_URL || !REAL_ANON || !REAL_ADMIN_PASSWORD, "NON TESTÉ: real stack not configured");
test.use({ bypassCSP: true });
// 8x8 px JPEG: the project fixtures exceed the 3 MiB bucket limit.
const TINY_JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDMooormOo//9k=", "base64");
const ADMIN = "admin@example.test", GUEST_ACCOUNT = "invite@example.test";
const client = () => createClient(REAL_URL, REAL_ANON, { auth: { persistSession: false } });

async function openAdmin(page) {
  await page.route("**/config.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const NAMES='';export const DATE_TXT='';export const SUPABASE_URL='${REAL_URL}';export const SUPABASE_KEY='${REAL_ANON}';export const BUCKET='photos';export const SECRET='';export const LOCATION='';export const COUPLE_PHOTO='';export const NSFW_ENABLED=true;`,
    }),
  );
  await page.goto(`${REAL_URL}/admin.html`);
}
async function login(page, email, password) {
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
}

test("RPC admin_status: allowed for the listed admin, refused to another real account and to the public", async () => {
  const anon = client();
  expect((await anon.rpc("admin_status")).error?.code).toBe("42501");
  const guest = client();
  expect((await guest.auth.signInWithPassword({ email: GUEST_ACCOUNT, password: REAL_ADMIN_PASSWORD })).error).toBeNull();
  expect((await guest.rpc("admin_status")).error?.code).toBe("42501");
  const admin = client();
  expect((await admin.auth.signInWithPassword({ email: ADMIN, password: REAL_ADMIN_PASSWORD })).error).toBeNull();
  const status = await admin.rpc("admin_status");
  expect(status.error).toBeNull();
  expect(status.data).toHaveProperty("storage_bytes");
});

test("private photos: readable only by the authorized admin session", async () => {
  const anon = client();
  const body = Buffer.concat([TINY_JPEG, Buffer.from(`adm:${Date.now()}`)]);
  const id = randomUUID(), paths = [`maries/thumbs/${id}.jpg`, `maries/full/${id}.jpg`];
  for (const p of paths) expect((await anon.storage.from("photos").upload(p, body, { contentType: "image/jpeg" })).error).toBeNull();
  const reg = await anon.rpc("register_photo", { p_id: id, p_audience: "maries", p_sha256: createHash("sha256").update(body).digest("hex"), p_uploader: randomUUID(), p_nsfw: "skipped" });
  expect(reg.data?.result).toBe("published");
  const signedBy = async (sb) => (await sb.storage.from("photos").createSignedUrls(paths, 60)).data?.every((s) => s.signedUrl);
  expect(await signedBy(anon)).toBeFalsy();
  const guest = client();
  await guest.auth.signInWithPassword({ email: GUEST_ACCOUNT, password: REAL_ADMIN_PASSWORD });
  expect(await signedBy(guest)).toBeFalsy();
  const admin = client();
  await admin.auth.signInWithPassword({ email: ADMIN, password: REAL_ADMIN_PASSWORD });
  expect(await signedBy(admin)).toBeTruthy();
});

test("browser: login, reload keeps the session, private photo visible, logout", async ({ page }) => {
  await openAdmin(page);
  await expect(page.locator("#login")).toBeVisible();
  await expect(page.locator("#admin-message")).not.toContainText("Chargement");
  await login(page, ADMIN, REAL_ADMIN_PASSWORD);
  await expect(page.locator("#dashboard")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#stats")).toContainText("Stockage");
  await expect(page.locator("#logout")).toBeVisible();
  await page.reload();
  await expect(page.locator("#dashboard")).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Mariés uniquement", exact: true }).click();
  const img = page.locator(".admin-card img").first();
  await expect(img).toBeVisible({ timeout: 15000 });
  await expect.poll(() => img.evaluate((i) => i.complete && i.naturalWidth > 0)).toBeTruthy();
  await page.locator("#logout").click();
  await expect(page.locator("#login")).toBeVisible();
  await expect(page.locator("#dashboard")).toBeHidden();
  await page.reload();
  await expect(page.locator("#login")).toBeVisible();
  await expect(page.locator("#dashboard")).toBeHidden();
});

test("browser: a real account that is not an administrator is refused and signed out", async ({ page }) => {
  await openAdmin(page);
  await login(page, GUEST_ACCOUNT, REAL_ADMIN_PASSWORD);
  await expect(page.locator("#admin-message")).toContainText("n’a pas accès", { timeout: 15000 });
  await expect(page.locator("#dashboard")).toBeHidden();
  await page.reload();
  await expect(page.locator("#login")).toBeVisible();
  await expect(page.locator("#dashboard")).toBeHidden();
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.includes("wedding-admin")).length && sessionStorage.getItem("wedding-admin"))).toBeFalsy();
});

test("browser: wrong password and unconfirmed e-mail give understandable messages", async ({ page }) => {
  await openAdmin(page);
  await login(page, ADMIN, "mauvais-mot-de-passe");
  await expect(page.locator("#admin-message")).toContainText("incorrect", { timeout: 15000 });
  test.skip(!REAL_SERVICE_KEY, "unconfirmed-user case needs the local service key");
  const email = `nonconfirme-${Date.now()}@example.test`;
  const res = await fetch(`http://127.0.0.1:5058/admin/users`, {
    method: "POST",
    headers: { Authorization: `Bearer ${REAL_SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: REAL_ADMIN_PASSWORD, email_confirm: false }),
  });
  expect(res.ok).toBeTruthy();
  await login(page, email, REAL_ADMIN_PASSWORD);
  await expect(page.locator("#admin-message")).toContainText("n’est pas confirmée", { timeout: 15000 });
});

// ---- Validation before publication, with a real server (the client cannot bypass it) ------------------------
async function guestSend(count, tag) {
  const anon = client();
  const out = [];
  for (let i = 0; i < count; i++) {
    const id = randomUUID();
    const body = Buffer.concat([TINY_JPEG, Buffer.from(`${tag}:${i}:${Date.now()}:${Math.random()}`)]);
    const paths = [`public/thumbs/${id}.jpg`, `public/full/${id}.jpg`];
    for (const p of paths) expect((await anon.storage.from("photos").upload(p, body, { contentType: "image/jpeg" })).error).toBeNull();
    // The client claims the photo is clean: only the server decides.
    const reg = await anon.rpc("register_photo", { p_id: id, p_audience: "public", p_sha256: createHash("sha256").update(body).digest("hex"), p_uploader: randomUUID(), p_nsfw: "clean" });
    out.push({ id, paths, result: reg.data?.result });
  }
  return out;
}
const guestCanSign = async (paths) => (await client().storage.from("photos").createSignedUrls(paths, 60)).data?.every((s) => s.signedUrl);
const galleryIds = async () => new Set(((await client().rpc("gallery_page", { p_limit: 100 })).data ?? []).map((r) => r.id));

test("validation before publication: server keeps photos pending, batch Valider publishes, batch Refuser hides, Retirer removes", async ({ page }) => {
  test.setTimeout(150000);
  const adminApi = client();
  await adminApi.auth.signInWithPassword({ email: ADMIN, password: REAL_ADMIN_PASSWORD });
  expect((await adminApi.rpc("admin_set_paused", { p_paused: true })).error).toBeNull();
  try {
    const pendingBefore = (await adminApi.rpc("admin_status")).data.pending;
    const [a, b, c] = await guestSend(3, "queue");
    for (const photo of [a, b, c]) expect(photo.result).toBe("pending_review"); // even with p_nsfw = 'clean'
    const visible = await galleryIds();
    for (const photo of [a, b, c]) {
      expect(visible.has(photo.id)).toBeFalsy();
      expect(await guestCanSign(photo.paths)).toBeFalsy();
    }
    await openAdmin(page);
    await login(page, ADMIN, REAL_ADMIN_PASSWORD);
    await expect(page.locator("#dashboard")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#pause")).toHaveText("Désactiver la validation avant publication");
    await page.getByRole("button", { name: /^En attente/ }).click();
    await expect(page.locator(`input[data-id="${a.id}"]`)).toHaveCount(1, { timeout: 15000 });
    await expect(page.locator("[data-filter=pending]")).toHaveText(`En attente (${pendingBefore + 3})`);
    const thumbsLoaded = () => page.locator(".admin-card img").evaluateAll((imgs) => imgs.every((i) => i.complete && i.naturalWidth > 0));
    await expect.poll(thumbsLoaded, { timeout: 15000 }).toBeTruthy();
    // Validate two of them in one batch.
    await page.locator(`input[data-id="${a.id}"]`).check();
    await page.locator(`input[data-id="${b.id}"]`).check();
    await page.locator("#batch-approve").click();
    await expect(page.locator("#admin-message")).toContainText("2 photos validées", { timeout: 20000 });
    const after = await galleryIds();
    expect(after.has(a.id) && after.has(b.id) && !after.has(c.id)).toBeTruthy();
    // Refuse the last one: confirmation, then hidden (still stored, never public).
    await page.locator(`input[data-id="${c.id}"]`).check();
    await page.locator("#batch-reject").click();
    await page.locator("#confirm-yes").click();
    await expect(page.locator("#admin-message")).toContainText("1 photo refusée", { timeout: 20000 });
    const rejected = c;
    expect((await galleryIds()).has(rejected.id)).toBeFalsy();
    expect(await guestCanSign(rejected.paths)).toBeFalsy();
    await page.getByRole("button", { name: "Masquées", exact: true }).click();
    await expect(page.locator(".admin-card")).not.toHaveCount(0);
    // Back to normal publication, then remove a published photo with the Récentes bar.
    expect((await adminApi.rpc("admin_set_paused", { p_paused: false })).error).toBeNull();
    const [d] = await guestSend(1, "remove");
    expect(d.result).toBe("published");
    expect((await galleryIds()).has(d.id)).toBeTruthy();
    await page.getByRole("button", { name: "Récentes", exact: true }).click();
    await page.locator("#admin-refresh").click();
    const mine = page.locator(`input[data-id="${d.id}"]`);
    await expect(mine).toHaveCount(1, { timeout: 15000 });
    await mine.check();
    await page.locator("#batch-remove").click();
    await expect(page.locator("#admin-message")).toContainText("1 photo retirée", { timeout: 20000 });
    expect((await galleryIds()).has(d.id)).toBeFalsy();
    expect(await guestCanSign(d.paths)).toBeFalsy();
  } finally {
    await adminApi.rpc("admin_set_paused", { p_paused: false });
  }
});
