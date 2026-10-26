// End message of a download or a share: a banner at the top (same look as the upload error banner), with the
// wording by platform, singular and plural, three lines at most, announced, closed by a tap, gone by itself.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installMock } from "./mock.js";
import { NAME, counter, recordDownloads, phone, IPHONE, ANDROID, WINDOWS } from "./share-helpers.js";

const cards = (page) => page.locator("#gallery .photo-card");
const status = (page) => page.locator("#gallery-status");
const box = (page, selector) => page.locator(selector).boundingBox();
const overlaps = (a, b) => !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);

async function run(page, { n, ua, scheme = "light", width = 375, height = 800, share = true, outcome = "ok", refused = false }) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  await recordDownloads(page);
  await phone(page, { ua, outcome, canShare: share, coarse: ua !== WINDOWS });
  await installMock(page, { photos: 4 });
  await page.goto("/");
  await expect(cards(page)).toHaveCount(4);
  await page.locator("#select-mode").click();
  for (let i = 0; i < n; i++) await cards(page).nth(i).click();
  if (refused) await page.evaluate(() => { mock.signRefused = true; });
  await page.locator("#dl-go").click();
  if (ua === IPHONE && share && !refused) await page.locator("#dl-go").click(); // "Préparer" then "Partager"
  else if (ua === IPHONE && share && refused) await page.locator("#dl-go").click();
  await expect(page.locator("#dl-bar")).toBeHidden({ timeout: 20000 });
}

const CASES = [
  ["Android, 1 photo", { n: 1, ua: ANDROID }, "downloaded", "Terminé : 1 photo téléchargée. Retrouvez-la dans Téléchargements (app Fichiers) ou dans votre Galerie."],
  ["Android, 3 photos", { n: 3, ua: ANDROID }, "downloaded", "Terminé : 3 photos téléchargées. Retrouvez-les dans Téléchargements (app Fichiers) ou dans votre Galerie."],
  ["iPhone, partage, 1 photo", { n: 1, ua: IPHONE }, "shared", "Terminé : 1 photo prête. Si vous avez choisi « Enregistrer l’image », elle est dans Photos."],
  ["iPhone, partage, 3 photos", { n: 3, ua: IPHONE }, "shared", "Terminé : 3 photos prêtes. Si vous avez choisi « Enregistrer l’image », elles sont dans Photos."],
  ["iPhone, téléchargement ordinaire, 2 photos", { n: 2, ua: IPHONE, share: false }, "downloaded", "Terminé : 2 photos téléchargées. Retrouvez-les dans l’app Fichiers (dossier Téléchargements)."],
  ["ordinateur, 2 photos", { n: 2, ua: WINDOWS }, "downloaded", "Terminé : 2 photos téléchargées. Retrouvez-les dans votre dossier Téléchargements."],
];
for (const [label, options, , text] of CASES)
  test(`wording: ${label}`, async ({ page }) => {
    await run(page, options);
    await expect(status(page)).toHaveText(text);
    await expect(status(page)).toHaveAttribute("data-kind", "done");
    await expect(status(page)).toHaveAttribute("role", "status");
  });

test("iPhone whose share is refused: the reason is in the message, the downloads keep their names", async ({ page }) => {
  await run(page, { n: 2, ua: IPHONE, outcome: "fail" });
  await expect(status(page)).toHaveText("Terminé : 2 photos téléchargées (partage refusé : NotAllowedError). Retrouvez-les dans l’app Fichiers (dossier Téléchargements).");
  expect(await page.evaluate(() => window.__downloads)).toEqual([NAME(1), NAME(2)]);
  expect(await counter(page)).toBe(2);
});

test("an error at the end of a download is an error banner", async ({ page }) => {
  await run(page, { n: 3, ua: ANDROID, refused: true });
  await expect(status(page)).toHaveText("3 photos n’ont pas pu être téléchargées.");
  await expect(status(page)).toHaveAttribute("data-kind", "error");
});

for (const scheme of ["light", "dark"])
  for (const [label, width, height] of [["375 px", 375, 800], ["desktop", 1280, 900]])
    test(`${scheme}, ${label}: the end message is a banner at the top, under the header, three lines at most`, async ({ page }) => {
      await run(page, { n: 3, ua: ANDROID, scheme, width, height });
      await expect(status(page)).toBeVisible();
      const info = await status(page).evaluate((n) => { const s = getComputedStyle(n); return { position: s.position, lines: Math.round(n.scrollHeight / parseFloat(s.lineHeight)), pad: parseFloat(s.paddingTop) + parseFloat(s.paddingBottom) }; });
      expect(info.position).toBe("fixed");
      const rect = await box(page, "#gallery-status");
      const header = await box(page, ".site-header");
      expect(rect.y).toBeLessThan(160);
      expect(rect.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(width);
      expect(Math.round((rect.height - info.pad) / 1.4 / 14.4)).toBeLessThanOrEqual(3);
      for (const selector of [".wordmark", "#theme-toggle", "#menu-toggle"]) {
        const b = await box(page, selector).catch(() => null);
        if (b && b.width) expect(overlaps(rect, b), selector).toBeFalsy();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    });

test("the longest messages still fit on three lines at 360 and 375 px", async ({ page }) => {
  for (const width of [360, 375]) {
    await run(page, { n: 2, ua: IPHONE, outcome: "fail", width });
    const rect = await box(page, "#gallery-status");
    const lineHeight = 14.4 * 1.4;
    expect(Math.round((rect.height - 25.6) / lineHeight), `${width} px`).toBeLessThanOrEqual(3);
  }
});

test("a tap closes it; otherwise it goes away by itself", async ({ page }) => {
  await run(page, { n: 2, ua: ANDROID });
  await expect(status(page)).toBeVisible();
  await status(page).click();
  await expect(status(page)).toBeEmpty();
  await run(page, { n: 2, ua: ANDROID });
  await expect(status(page)).toBeVisible();
  await page.waitForTimeout(10600);
  await expect(status(page)).toBeEmpty();
  await expect(status(page)).not.toHaveAttribute("data-kind", /.+/);
});

test("the single photo of the lightbox says the same, per platform", async ({ page }) => {
  await recordDownloads(page);
  await phone(page, { ua: ANDROID });
  await page.setViewportSize({ width: 375, height: 800 });
  await installMock(page, { photos: 2 });
  await page.route(/\/fixtures\/photo_01\.jpg\?download=1$/, (route) => route.fulfill({ body: "x", contentType: "image/jpeg" }));
  await page.goto("/");
  await cards(page).first().click();
  await page.locator("#download").click();
  await expect(page.locator("#save-note")).toHaveText("Terminé : 1 photo téléchargée. Retrouvez-la dans Téléchargements (app Fichiers) ou dans votre Galerie.");
});

test("the single photo shared on iPhone: 'Terminé : 1 photo prête…'", async ({ page }) => {
  await phone(page, { ua: IPHONE });
  await page.setViewportSize({ width: 375, height: 800 });
  await installMock(page, { photos: 2 });
  await page.goto("/");
  await cards(page).first().click();
  await expect(page.locator("#save-photo")).toBeEnabled({ timeout: 10000 });
  await page.locator("#save-photo").click();
  await expect(page.locator("#save-note")).toHaveText("Terminé : 1 photo prête. Si vous avez choisi « Enregistrer l’image », elle est dans Photos.");
});

for (const scheme of ["light", "dark"])
  test(`${scheme}: axe with the end message open`, async ({ page }) => {
    await run(page, { n: 3, ua: ANDROID, scheme });
    await expect(status(page)).toBeVisible();
    await page.waitForTimeout(500);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
