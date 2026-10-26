// Point 1: "Enregistrer dans Photos" in the lightbox (native share of one photo, prepared when it opens), the method
// and the reason of a fallback shown to the guest, and where to find the photos afterwards.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installMock } from "./mock.js";
import { NAME, counter, downloads, recordDownloads, phone, IPHONE, ANDROID, IPAD_DESKTOP, WINDOWS } from "./share-helpers.js";

const cards = (page) => page.locator("#gallery .photo-card");
async function open(page, photos = 4, scheme = "light") {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  await installMock(page, { photos });
  await page.route(/\/fixtures\/photo_01\.jpg\?download=1$/, (route) => route.fulfill({ body: "x", contentType: "image/jpeg" }));
  await page.goto("/");
  await expect(cards(page)).toHaveCount(photos);
}
async function openPhoto(page, index = 0) {
  await cards(page).nth(index).click();
  await expect(page.locator("#lightbox")).toBeVisible();
}
const save = (page) => page.locator("#save-photo");

test.describe("lightbox: save one photo", () => {
  test("no share on a computer: the button is absent and the download is untouched", async ({ page }) => {
    await recordDownloads(page);
    await phone(page, { coarse: false });
    await open(page);
    await openPhoto(page);
    await expect(save(page)).toBeHidden();
    await page.locator("#download").click();
    await expect.poll(() => counter(page)).toBe(1);
    expect(await downloads(page)).toEqual([NAME(1)]);
    // The location of the file is now said, without changing the file, its name or the counter.
    await expect(page.locator("#save-note")).toContainText("Téléchargements");
  });

  test("phone: the photo is prepared when the lightbox opens, then one tap shares it at once", async ({ page }) => {
    await recordDownloads(page);
    await phone(page);
    await open(page);
    await openPhoto(page);
    await expect(save(page)).toBeVisible();
    await expect(save(page)).toBeEnabled({ timeout: 10000 }); // prepared
    const before = await page.evaluate(() => window.__fetches);
    await save(page).click();
    await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
    // No fetch between the tap and the share: the gesture is still valid.
    expect(await page.evaluate(() => window.__sharedAtFetchCount[0])).toBe(before);
    expect(await page.evaluate(() => window.__shared[0])).toEqual([`${NAME(1)}|image/jpeg|true`]);
    expect(await counter(page)).toBe(1);
    expect(await downloads(page)).toEqual([]);
    await expect(page.locator("#save-note")).toContainText("Photos");
  });

  test("the button says where it goes on iPhone and is generic elsewhere; target of 44 px", async ({ page }) => {
    await phone(page, { ua: IPHONE });
    await open(page);
    await openPhoto(page);
    await expect(save(page)).toContainText("Enregistrer dans Photos");
    const box = await save(page).boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
  });

  test("Android: no native share, no button; the current download is used and says where the file goes", async ({ page }) => {
    await recordDownloads(page);
    await phone(page, { ua: ANDROID }); // the browser could share files, the app does not offer it on Android
    await open(page);
    await openPhoto(page);
    await expect(save(page)).toBeHidden();
    await page.locator("#download").click();
    await expect.poll(() => counter(page)).toBe(1);
    expect(await downloads(page)).toEqual([NAME(1)]);
    expect(await page.evaluate(() => window.__shared.length)).toBe(0);
    await expect(page.locator("#save-note")).toContainText("dossier Téléchargements");
  });

  test("iPad asking for the desktop site (Macintosh user agent, touch) still counts as iOS", async ({ page }) => {
    await phone(page, { ua: IPAD_DESKTOP, touchPoints: 5 });
    await open(page);
    await openPhoto(page);
    await expect(save(page)).toBeVisible();
    await expect(save(page)).toContainText("Enregistrer dans Photos");
  });

  test("a touch laptop (Windows) downloads, it does not share", async ({ page }) => {
    await phone(page, { ua: WINDOWS });
    await open(page);
    await openPhoto(page);
    await expect(save(page)).toBeHidden();
  });

  test("a dismissed share consumes no number and the tap can be repeated", async ({ page }) => {
    await phone(page, { outcome: "abort-once" });
    await open(page);
    await openPhoto(page);
    await expect(save(page)).toBeEnabled({ timeout: 10000 });
    await save(page).click();
    await expect(page.locator("#save-note")).toContainText("annulé");
    expect(await counter(page)).toBe(0);
    await expect(save(page)).toBeEnabled();
    await save(page).click();
    await expect.poll(() => counter(page)).toBe(1);
    expect(await page.evaluate(() => window.__shared.map((s) => s[0].split("|")[0]))).toEqual([NAME(1), NAME(1)]);
  });

  test("a refused share falls back to the current download and names the reason", async ({ page }) => {
    await recordDownloads(page);
    await phone(page, { outcome: "fail", errorName: "NotAllowedError", ua: IPHONE });
    await open(page);
    await openPhoto(page);
    await expect(save(page)).toBeEnabled({ timeout: 10000 });
    await save(page).click();
    await expect.poll(() => counter(page)).toBe(1);
    expect(await downloads(page)).toEqual([NAME(1)]);
    await expect(page.locator("#save-note")).toContainText("refusé (NotAllowedError)");
    await expect(page.locator("#save-note")).toContainText("Fichiers");
  });

  test("a photo that cannot be prepared hides the button, says why, and the download still works", async ({ page }) => {
    await recordDownloads(page);
    await phone(page);
    await open(page);
    await page.route(/\/fixtures\/photo_01\.jpg$/, (route) => route.abort());
    await openPhoto(page);
    await expect(save(page)).toBeHidden({ timeout: 10000 });
    await expect(page.locator("#save-note")).toContainText("indisponible");
    await page.locator("#download").click();
    await expect.poll(() => counter(page)).toBe(1);
    expect(await downloads(page)).toEqual([NAME(1)]);
  });

  test("a photo Storage refuses is never prepared nor shared", async ({ page }) => {
    await phone(page);
    await open(page);
    await page.evaluate(() => { mock.signRefused = true; });
    await openPhoto(page);
    await expect(save(page)).toBeHidden({ timeout: 10000 });
    expect(await page.evaluate(() => window.__shared.length)).toBe(0);
    expect(await counter(page)).toBe(0);
  });

  test("moving to the next photo prepares that photo: the shared file is always the one on screen", async ({ page }) => {
    await phone(page);
    await open(page, 3);
    await openPhoto(page);
    await expect(save(page)).toBeEnabled({ timeout: 10000 });
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#photo-position")).toHaveText("2 / 3");
    await expect(save(page)).toBeEnabled({ timeout: 10000 });
    await save(page).click();
    await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
    const paths = await page.evaluate(() => mock.calls.filter((c) => c[0] === "sign" && !c[3]).map((c) => c[1]));
    expect(paths.every((p) => p.startsWith("public/full/"))).toBeTruthy();
    expect(paths.at(-1)).toContain("00000001"); // the second photo
  });

  for (const scheme of ["light", "dark"])
    for (const width of [360, 375, 412, 768])
      test(`${scheme} at ${width}px: the three actions fit, no overflow, 44 px targets`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await phone(page);
        await open(page, 3, scheme);
        await openPhoto(page);
        await expect(save(page)).toBeEnabled({ timeout: 10000 });
        for (const id of ["save-photo", "download", "report-open"]) {
          const box = await page.locator(`#${id}`).boundingBox();
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      });

  for (const scheme of ["light", "dark"])
    test(`${scheme}: axe on the lightbox with the new button`, async ({ page }) => {
      await phone(page);
      await open(page, 3, scheme);
      await openPhoto(page);
      await expect(save(page)).toBeEnabled({ timeout: 10000 });
      await page.waitForTimeout(800);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    });
});

test.describe("batch: method, reason and location", () => {
  const select = async (page, n) => {
    await page.locator("#select-mode").click();
    for (let i = 0; i < n; i++) await cards(page).nth(i).click();
  };

  test("computer: direct download, reason and location written in the bar", async ({ page }) => {
    await phone(page, { coarse: false });
    await open(page);
    await select(page, 2);
    await expect(page.locator("#dl-note")).toContainText("Téléchargement direct (appareil non tactile)");
    await expect(page.locator("#dl-note")).toContainText("dossier Téléchargements");
  });

  test("iPhone whose browser cannot share files: reason shown", async ({ page }) => {
    await phone(page, { canShare: "missing", ua: IPHONE });
    await open(page);
    await select(page, 2);
    await expect(page.locator("#dl-note")).toContainText("Téléchargement direct (ce navigateur ne partage pas les fichiers)");
    await expect(page.locator("#dl-go")).toHaveText("Télécharger 2 photos");
  });

  test("touch phone whose browser refuses photos: reason shown, iPhone location is Fichiers", async ({ page }) => {
    await phone(page, { canShare: false, ua: IPHONE });
    await open(page);
    await select(page, 2);
    await expect(page.locator("#dl-note")).toContainText("Téléchargement direct (ce navigateur refuse le partage de photos)");
    await expect(page.locator("#dl-note")).toContainText("app Fichiers");
  });

  test("Android: direct download announced with the folder and the multiple-downloads prompt, never a share", async ({ page }) => {
    await recordDownloads(page);
    await phone(page, { ua: ANDROID });
    await open(page);
    await select(page, 2);
    const note = page.locator("#dl-note");
    await expect(note).toHaveText("Téléchargement direct : photos dans Téléchargements (app Fichiers). Si Chrome demande « Autoriser plusieurs téléchargements », touchez « Autoriser ».");
    await expect(page.locator("#dl-go")).toHaveText("Télécharger 2 photos");
    await page.locator("#dl-go").click();
    await expect(page.locator("#dl-bar")).toBeHidden({ timeout: 15000 });
    expect(await page.evaluate(() => window.__shared.length)).toBe(0);
    expect(await downloads(page)).toEqual([NAME(1), NAME(2)]);
    expect(await counter(page)).toBe(2);
    const status = page.locator("#gallery-status");
    await expect(status).toContainText("2 photos téléchargées");
    await expect(status).toContainText("dossier Téléchargements");
    await expect(status).toContainText("Galerie");
    await expect(status).toContainText("Autoriser");
  });

  test("a single downloaded photo on Android carries no multiple-downloads hint", async ({ page }) => {
    await recordDownloads(page);
    await phone(page, { ua: ANDROID });
    await open(page);
    await select(page, 1);
    await page.locator("#dl-go").click();
    await expect(page.locator("#dl-bar")).toBeHidden({ timeout: 15000 });
    await expect(page.locator("#gallery-status")).not.toContainText("Autoriser");
  });

  test("share available: the bar announces the two steps and Photos", async ({ page }) => {
    await phone(page);
    await open(page);
    await select(page, 2);
    await expect(page.locator("#dl-note")).toContainText("Préparer");
    await expect(page.locator("#dl-note")).toContainText("Photos");
    await expect(page.locator("#dl-go")).toHaveText("Préparer 2 photos");
  });

  test("share success: the final message says where the photos are", async ({ page }) => {
    await phone(page, { ua: IPHONE });
    await open(page);
    await select(page, 2);
    await page.locator("#dl-go").click();
    await expect(page.locator("#dl-go")).toHaveText("Partager 2 photos");
    await page.locator("#dl-go").click();
    await expect(page.locator("#dl-bar")).toBeHidden();
    await expect(page.locator("#gallery-status")).toContainText("2 photos partagées");
    await expect(page.locator("#gallery-status")).toContainText("Photos");
  });

  test("share refused on iPhone: the fallback says why, downloads keep their names and the location is given", async ({ page }) => {
    await recordDownloads(page);
    await phone(page, { outcome: "fail", errorName: "NotAllowedError", ua: IPHONE });
    await open(page);
    await select(page, 2);
    await page.locator("#dl-go").click();
    await page.locator("#dl-go").click();
    await expect(page.locator("#dl-bar")).toBeHidden({ timeout: 15000 });
    expect(await downloads(page)).toEqual([NAME(1), NAME(2)]);
    expect(await counter(page)).toBe(2);
    const status = page.locator("#gallery-status");
    await expect(status).toContainText("2 photos téléchargées");
    await expect(status).toContainText("refusé (NotAllowedError)");
    await expect(status).toContainText("app Fichiers");
  });

  test("direct download: the final message says where the photos are", async ({ page }) => {
    await recordDownloads(page);
    await phone(page, { coarse: false });
    await open(page);
    await select(page, 2);
    await page.locator("#dl-go").click();
    await expect(page.locator("#dl-bar")).toBeHidden({ timeout: 15000 });
    await expect(page.locator("#gallery-status")).toContainText("2 photos téléchargées");
    await expect(page.locator("#gallery-status")).toContainText("Retrouvez-les");
  });
});
