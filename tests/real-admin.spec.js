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
