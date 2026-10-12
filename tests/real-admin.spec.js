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
    // Only the three photos of this test: other pending photos left by earlier tests may sit below the fold (lazy-loaded).
    const thumbsLoaded = async () => {
      for (const photo of [a, b, c]) {
        const img = page.locator(`.admin-card:has(input[data-id="${photo.id}"]) img`).first();
        await img.scrollIntoViewIfNeeded();
        if (!(await img.evaluate((i) => i.complete && i.naturalWidth > 0))) return false;
      }
      return true;
    };
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

// ---- Guest send bar: the destination chosen in the bar is the one the server receives ------------------------
test("real stack: the destination card picked first decides the Storage path and the audience", async ({ page }) => {
  test.setTimeout(150000);
  const adminApi = client();
  await adminApi.auth.signInWithPassword({ email: ADMIN, password: REAL_ADMIN_PASSWORD });
  await adminApi.rpc("admin_set_paused", { p_paused: false });
  const fs = await import("node:fs/promises");
  const photo = async (name, tag) => ({ name, mimeType: "image/jpeg", buffer: Buffer.concat([await fs.readFile("fixtures/photo_02.jpg"), Buffer.from(`${tag}${Date.now()}${Math.random()}`)]) });
  await page.route("**/config.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const NAMES='';export const DATE_TXT='';export const SUPABASE_URL='${REAL_URL}';export const SUPABASE_KEY='${REAL_ANON}';export const BUCKET='photos';export const SECRET='';export const LOCATION='';export const COUPLE_PHOTO='';export const NSFW_ENABLED=true;`,
    }),
  );
  await page.goto(`${REAL_URL}/#partager`);
  const send = async (value) => {
    // The real journey: destination card first (it opens the chooser), then preview, then confirm.
    const chooser = page.waitForEvent("filechooser");
    await page.locator(`[data-destination=${value}]`).click();
    await (await chooser).setFiles([await photo(`${value}.jpg`, value)]);
    await expect(page.locator(`[name=audience][value=${value}]`)).toBeChecked();
    await expect(page.locator("#send")).toBeEnabled();
    await page.locator("#send").click();
    await expect(page.locator("#upload-message")).toHaveAttribute("data-kind", /success|pending/, { timeout: 90000 });
    await expect(page.locator("[name=audience]:checked")).toHaveCount(0); // forgotten after a successful send
    await expect(page.locator("#choose-step")).toBeVisible(); // back to step 1
  };
  const newest = async (filter) => (await adminApi.rpc("admin_list_photos", { p_filter: filter, p_limit: 5 })).data;
  await send("maries");
  const priv = (await newest("maries"))[0];
  expect(priv.audience).toBe("maries");
  expect(priv.full_path.startsWith("maries/full/") && priv.thumb_path.startsWith("maries/thumbs/")).toBeTruthy();
  await send("public");
  const pub = (await newest("recent"))[0];
  expect(pub.audience).toBe("public");
  expect(pub.full_path.startsWith("public/full/")).toBeTruthy();
  expect(await guestCanSign([pub.full_path, pub.thumb_path])).toBeTruthy();
  expect(await guestCanSign([priv.full_path, priv.thumb_path])).toBeFalsy();
});

// ---- Batch delete with the real Storage: both objects really disappear ----------------------------------------
test("real stack: batch Supprimer deletes the rows and BOTH Storage objects of each photo", async ({ page }) => {
  test.setTimeout(150000);
  const adminApi = client();
  await adminApi.auth.signInWithPassword({ email: ADMIN, password: REAL_ADMIN_PASSWORD });
  await adminApi.rpc("admin_set_paused", { p_paused: false });
  const [a, b, keep] = await guestSend(3, "batchdelete");
  for (const p of [a, b, keep]) expect(p.result).toBe("published");
  const exists = async (paths) => (await adminApi.storage.from("photos").createSignedUrls(paths, 60)).data?.map((s) => Boolean(s.signedUrl));
  expect(await exists([...a.paths, ...b.paths, ...keep.paths])).toEqual(Array(6).fill(true));
  await openAdmin(page);
  await login(page, ADMIN, REAL_ADMIN_PASSWORD);
  await expect(page.locator("#dashboard")).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Récentes", exact: true }).click();
  await expect(page.locator(`input[data-id="${a.id}"]`)).toHaveCount(1, { timeout: 15000 });
  await page.locator(`input[data-id="${a.id}"]`).check();
  await page.locator(`input[data-id="${b.id}"]`).check();
  await page.locator("#batch-delete").click();
  await expect(page.locator("#confirm-message")).toContainText("Supprimer définitivement 2 photos ?");
  // Cancelling first: nothing is touched.
  await page.locator("#confirm-no").click();
  expect(await exists([...a.paths, ...b.paths])).toEqual(Array(4).fill(true));
  await page.locator("#batch-delete").click();
  await page.locator("#confirm-yes").click();
  await expect(page.locator("#admin-message")).toContainText("2 photos supprimées définitivement.", { timeout: 30000 });
  await expect(page.locator("#admin-message")).not.toContainText("n’ont pas pu être effacés");
  // Rows gone from the admin lists, files gone from Storage (the third photo is untouched).
  const listed = (await adminApi.rpc("admin_list_photos", { p_filter: "recent", p_limit: 200 })).data.map((r) => r.id);
  expect(listed.includes(a.id) || listed.includes(b.id)).toBeFalsy();
  expect(listed.includes(keep.id)).toBeTruthy();
  expect(await exists([...a.paths, ...b.paths])).toEqual(Array(4).fill(false));
  expect(await exists(keep.paths)).toEqual([true, true]);
  const visible = await galleryIds();
  expect(visible.has(a.id) || visible.has(b.id)).toBeFalsy();
  expect(visible.has(keep.id)).toBeTruthy();
});


// ---- One valid report hides the photo; the administrator sees reason and comment; Restaurer brings it back ------
test("real stack: guest report with a reason hides the photo at once; admin sees reason and comment and restores it", async ({ page }) => {
  test.setTimeout(150000);
  const adminApi = client();
  await adminApi.auth.signInWithPassword({ email: ADMIN, password: REAL_ADMIN_PASSWORD });
  await adminApi.rpc("admin_set_paused", { p_paused: false });
  const [target] = await guestSend(1, "report");
  expect(target.result).toBe("published");
  const guest = await page.context().newPage();
  await guest.route("**/config.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const NAMES='';export const DATE_TXT='';export const SUPABASE_URL='${REAL_URL}';export const SUPABASE_KEY='${REAL_ANON}';export const BUCKET='photos';export const SECRET='';export const LOCATION='';export const COUPLE_PHOTO='';export const NSFW_ENABLED=true;`,
    }),
  );
  await guest.goto(`${REAL_URL}/#galerie`);
  const card = guest.locator(`[data-photo-id="${target.id}"]`);
  await expect(card).toHaveCount(1, { timeout: 20000 });
  await card.click();
  await guest.locator("#report-open").click();
  await expect(guest.locator("#report-submit")).toBeDisabled();
  await guest.getByRole("radio", { name: "Autre raison" }).check();
  await expect(guest.locator("#report-submit")).toBeDisabled(); // description required
  await guest.locator("#report-comment").fill("Objet qui n'a pas sa place ici");
  await guest.getByRole("button", { name: "Envoyer le signalement" }).click();
  await expect(guest.locator("#gallery-status")).toContainText("Merci pour votre signalement. Cette photo a été retirée temporairement", { timeout: 15000 });
  await expect(card).toHaveCount(0);
  // Server side: hidden, no new link for guests, files kept.
  expect((await galleryIds()).has(target.id)).toBeFalsy();
  expect(await guestCanSign(target.paths)).toBeFalsy();
  const row = (await adminApi.rpc("admin_list_photos", { p_filter: "reported", p_limit: 50 })).data.find((r) => r.id === target.id);
  expect(row).toMatchObject({ status: "hidden", review_reason: "reports", report_count: 1, open_reports: 1 });
  expect(row.reports[0]).toMatchObject({ reason: "other", comment: "Objet qui n'a pas sa place ici" });
  expect((await adminApi.storage.from("photos").createSignedUrls(target.paths, 60)).data.every((s) => s.signedUrl)).toBeTruthy(); // kept for review
  // The administrator's screen.
  await openAdmin(page);
  await login(page, ADMIN, REAL_ADMIN_PASSWORD);
  await expect(page.locator("#dashboard")).toBeVisible({ timeout: 15000 });
  const adminCard = page.locator(".admin-card", { has: page.locator(`input[data-id="${target.id}"]`) });
  await expect(adminCard).toHaveCount(1, { timeout: 15000 });
  await expect(adminCard).toContainText("Autre raison");
  await expect(adminCard).toContainText("« Objet qui n'a pas sa place ici »");
  await expect(adminCard).toContainText("1 signalement au total · 1 à examiner");
  await adminCard.getByRole("button", { name: "Restaurer", exact: true }).click();
  await expect(adminCard).toHaveCount(0, { timeout: 15000 });
  expect((await galleryIds()).has(target.id)).toBeTruthy();
  expect(await guestCanSign(target.paths)).toBeTruthy();
  const after = (await adminApi.rpc("admin_list_photos", { p_filter: "recent", p_limit: 200 })).data.find((r) => r.id === target.id);
  expect(after).toMatchObject({ status: "published", report_count: 1, open_reports: 0 });
  expect(after.last_decision.action).toBe("restored");
  // The old report does not hide it again; a refresh keeps it visible.
  await guest.locator("#refresh").click();
  await expect(guest.locator(`[data-photo-id="${target.id}"]`)).toHaveCount(1, { timeout: 15000 });
  expect((await galleryIds()).has(target.id)).toBeTruthy();
});

test("real stack: a guest cannot reach the moderation functions or edit a report", async () => {
  const anon = client();
  const guestAccount = client();
  await guestAccount.auth.signInWithPassword({ email: GUEST_ACCOUNT, password: REAL_ADMIN_PASSWORD });
  const [photo] = await guestSend(1, "forbidden");
  for (const who of [anon, guestAccount]) {
    for (const [fn, args] of [["admin_set_status", { p_id: photo.id, p_status: "published" }], ["admin_list_photos", { p_filter: "reported" }], ["admin_status", {}]])
      expect((await who.rpc(fn, args)).error?.code).toBe("42501");
    expect((await who.from("photo_reports").select("*")).error ?? { ok: true }).toBeTruthy();
    expect((await who.from("photo_reports").update({ resolved_at: new Date().toISOString() }).eq("photo_id", photo.id).select()).data ?? []).toHaveLength(0);
    expect((await who.from("photo_moderation").select("*")).data ?? []).toHaveLength(0);
    expect((await who.from("photos").update({ status: "hidden" }).eq("id", photo.id).select()).data ?? []).toHaveLength(0);
  }
});
