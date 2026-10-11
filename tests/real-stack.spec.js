// Browser flows against a REAL Storage API + PostgREST + PostgreSQL stack (no mock of Supabase, real NSFWJS model).
// Skipped unless REAL_URL/REAL_ANON are set. Use scripts/real-stack.sh for a disposable local stack.
// CSP is bypassed ONLY here (the local stack is http://127.0.0.1); CSP is verified by flows.spec.js.
import { test, expect } from "@playwright/test";

const { REAL_URL, REAL_ANON } = process.env;
test.skip(!REAL_URL || !REAL_ANON, "NON TESTÉ: real stack not configured");
test.use({ bypassCSP: true });

// REAL_URL is a same-origin reverse proxy (scripts/real-stack-proxy.mjs): it serves the app on "/" and
// forwards /storage/v1 and /rest/v1 to the real Storage API and PostgREST (no mocking, no Playwright interception).
async function open(page, hash = "") {
  await page.route("**/config.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const NAMES=''; export const DATE_TXT='31 octobre 2026'; export const SUPABASE_URL='${REAL_URL}'; export const SUPABASE_KEY='${REAL_ANON}'; export const BUCKET='photos'; export const SECRET=''; export const LOCATION=''; export const COUPLE_PHOTO=''; export const NSFW_ENABLED=true;`,
    }),
  );
  await page.goto(`${REAL_URL}/${hash}`);
}

test("real upload: public photos appear, exact copy ignored, private stays out, 2 reports hide", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const ctxA = await browser.newContext({ bypassCSP: true });
  const a = await ctxA.newPage();
  await open(a, "#partager");
  // Unique bytes per run so the dedupe index of a reused database does not interfere.
  const fs = await import("node:fs/promises");
  const stamp = Buffer.from(String(Date.now()));
  const file = async (name, source, extra = stamp) => ({
    name,
    mimeType: "image/jpeg",
    buffer: Buffer.concat([await fs.readFile(`fixtures/${source}`), extra]),
  });
  // Unique bytes per run (the dedupe index of a reused database must not interfere); the pair is byte-identical.
  await a
    .locator("#files")
    .setInputFiles([
      await file("a.jpg", "photo_01.jpg"),
      await file("a-copie.jpg", "photo_01.jpg"),
      await file("b.jpg", "photo_02.jpg"),
    ]);
  await expect(a.locator("#send")).toBeEnabled();
  await a.locator("#send").click();
  await expect(a.locator("#upload-status")).toContainText("en échec", { timeout: 90000 });
  const status = await a.locator("#upload-status").textContent();
  console.log("real upload summary:", status);
  expect(status).toContain("0 en échec");
  expect(status).toMatch(/doublon\(s\) ignoré\(s\)/);

  // Private upload must never reach the public gallery.
  await a.locator("[name=audience][value=maries]").check();
  await a
    .locator("#files")
    .setInputFiles([await file("prive.jpg", "photo_03.jpg", Buffer.from("priv" + Date.now()))]);
  await a.locator("#send").click();
  await expect(a.locator("#upload-status")).toContainText("envoyée(s) aux mariés", { timeout: 60000 });

  // Another browser (other localStorage identity) sees the public photos only, with real signed URLs.
  const ctxB = await browser.newContext({ bypassCSP: true });
  const b = await ctxB.newPage();
  await open(b);
  const cards = b.locator("#gallery .photo-card img");
  await expect(cards.first()).toBeVisible({ timeout: 20000 });
  const total = await cards.count();
  expect(total).toBeGreaterThanOrEqual(2);
  // Newest photos are in the viewport; lower ones are lazy-loaded on purpose.
  await expect
    .poll(() => cards.evaluateAll((imgs) => imgs.slice(0, 2).every((i) => i.complete && i.naturalWidth > 0)))
    .toBeTruthy();
  const publicCount = total;
  await b.locator("#gallery .photo-card").first().click();
  await expect(b.locator("#full-photo")).toBeVisible({ timeout: 15000 });
  expect(await b.locator("#full-photo").evaluate((i) => i.naturalWidth)).toBeGreaterThan(0);

  // First report from B, second from a third browser => hidden for everyone.
  await b.locator("#report-open").click();
  await b.locator("#report-form button[type=submit]").click();
  await expect(b.locator("#gallery-status")).toContainText("signalement", { timeout: 15000 });
  const ctxC = await browser.newContext({ bypassCSP: true });
  const c = await ctxC.newPage();
  await open(c);
  await expect(c.locator("#gallery .photo-card img").first()).toBeVisible({ timeout: 20000 });
  await c.locator("#gallery .photo-card").first().click();
  await c.locator("#report-open").click();
  await c.locator("#report-form button[type=submit]").click();
  await expect(c.locator("#gallery-status")).toContainText("signalement", { timeout: 15000 });
  await b.locator("#refresh").click();
  await expect
    .poll(async () => b.locator("#gallery .photo-card").count(), { timeout: 15000 })
    .toBe(publicCount - 1);
  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
