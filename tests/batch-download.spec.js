// Grouped download on the public gallery: selection, "select all", the 20-photo cap, names and counter,
// native share (two steps) with automatic fallback to successive downloads, cancellation, refusals.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installMock } from "./mock.js";

const NAME = (n) => `photo_mariage_Thomas-Aziliz_311026_${String(n).padStart(2, "0")}.jpg`;
const cards = (page) => page.locator("#gallery .photo-card");
const counter = (page) => page.evaluate(() => Number(sessionStorage.getItem("wk_downloads") || 0));
const anchors = (page) => page.evaluate(() => window.__downloads);

// Records the programmatic <a download> clicks instead of letting the browser save files.
async function recordDownloads(page) {
  await page.addInitScript(() => {
    window.__downloads = [];
    HTMLAnchorElement.prototype.click = function () {
      if (this.hasAttribute("download")) window.__downloads.push(this.getAttribute("download"));
    };
  });
}
// A touch phone whose browser can share files; `outcome` is what the share sheet does.
async function touchShare(page, outcome = "ok") {
  await page.addInitScript((outcome) => {
    const real = window.matchMedia.bind(window);
    Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1" });
    window.matchMedia = (query) => (/pointer:\s*coarse/.test(query) ? { matches: true, media: query, addEventListener() {}, removeEventListener() {} } : real(query));
    window.__shared = [];
    navigator.canShare = () => true;
    navigator.share = (data) => {
      window.__shared.push(data.files.map((f) => `${f.name}|${f.type}|${f.size > 0}`));
      if (outcome === "abort-once" && window.__shared.length === 1) return Promise.reject(new DOMException("cancelled", "AbortError"));
      if (outcome === "fail") return Promise.reject(new DOMException("denied", "NotAllowedError"));
      return Promise.resolve();
    };
  }, outcome);
}
async function open(page, photos = 5, options = {}) {
  // Reduced motion also turns off the smooth page scroll: Playwright aims at a card, and a scroll still gliding
  // under the click would land it between two cards.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installMock(page, { photos, ...options });
  await page.goto("/");
  await expect(cards(page)).toHaveCount(photos);
}
async function selectMode(page) {
  await page.locator("#select-mode").click();
  await expect(page.locator("#dl-bar")).toBeVisible();
}

test("selection mode: cards are ticked instead of opening the lightbox, counter, leaving clears everything", async ({ page }) => {
  await open(page);
  await expect(page.locator("#select-mode")).toHaveAttribute("aria-pressed", "false");
  await selectMode(page);
  await expect(page.locator("#dl-count")).toHaveText("Aucune photo sélectionnée");
  await cards(page).nth(0).click();
  await expect(page.locator("#lightbox")).toBeHidden();
  await expect(cards(page).nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#dl-count")).toHaveText("1 photo sélectionnée");
  await cards(page).nth(2).click();
  await expect(page.locator("#dl-count")).toHaveText("2 photos sélectionnées");
  await cards(page).nth(2).click();
  await expect(page.locator("#dl-count")).toHaveText("1 photo sélectionnée");
  await page.locator("#dl-cancel").click();
  await expect(page.locator("#dl-bar")).toBeHidden();
  await expect(page.locator("#gallery .is-selected")).toHaveCount(0);
  // Outside the selection mode a card opens the lightbox again, and the single download is untouched.
  await cards(page).nth(0).click();
  await expect(page.locator("#lightbox")).toBeVisible();
  await expect(page.locator("#download")).toBeVisible();
});

test("'Tout sélectionner' ticks every loaded photo and toggles back", async ({ page }) => {
  await open(page, 7);
  await selectMode(page);
  await page.locator("#dl-all").click();
  await expect(page.locator("#dl-count")).toHaveText("7 photos sélectionnées");
  await expect(page.locator("#gallery .is-selected")).toHaveCount(7);
  await expect(page.locator("#dl-all")).toHaveText("Tout désélectionner");
  await page.locator("#dl-all").click();
  await expect(page.locator("#dl-count")).toHaveText("Aucune photo sélectionnée");
});

test("more than 20 photos: button disabled with a clear message, never a silent cut", async ({ page }) => {
  await open(page, 25);
  await selectMode(page);
  await page.locator("#dl-all").click();
  await expect(page.locator("#dl-count")).toHaveText("25 photos sélectionnées");
  await expect(page.locator("#dl-go")).toBeDisabled();
  await expect(page.locator("#dl-note")).toHaveText("20 photos au maximum par lot. Décochez 5 photos pour continuer.");
  for (let i = 20; i < 24; i++) {
    await cards(page).nth(i).click();
    // One tick at a time: wait for the counter before the next click.
    await expect(page.locator("#dl-count")).toHaveText(`${25 - (i - 19)} photos sélectionnées`);
  }
  await expect(page.locator("#dl-note")).toHaveText("20 photos au maximum par lot. Décochez 1 photo pour continuer.");
  await cards(page).nth(24).click();
  await expect(page.locator("#dl-count")).toHaveText("20 photos sélectionnées");
  await expect(page.locator("#dl-go")).toBeEnabled();
  await expect(page.locator("#dl-note")).not.toContainText("maximum");
});

test("desktop: successive downloads, names NN+1 to NN+n, counter consumed one by one, selection cleared at the end", async ({ page }) => {
  await recordDownloads(page);
  await open(page, 5);
  await page.evaluate(() => sessionStorage.setItem("wk_downloads", "2"));
  await selectMode(page);
  for (const i of [0, 1, 3]) await cards(page).nth(i).click();
  await expect(page.locator("#dl-go")).toHaveText("Télécharger 3 photos");
  await page.locator("#dl-go").click();
  await expect(page.locator("#dl-bar")).toBeHidden({ timeout: 15000 });
  expect(await anchors(page)).toEqual([NAME(3), NAME(4), NAME(5)]);
  expect(await counter(page)).toBe(5);
  await expect(page.locator("#gallery-status")).toContainText("3 photos téléchargées.");
  await expect(page.locator("#gallery .is-selected")).toHaveCount(0);
  // The single download continues the same numbering.
  await page.route("**/fixtures/photo_01.jpg?download=1", (route) => route.fulfill({ body: "x", contentType: "image/jpeg" }));
  await cards(page).first().click();
  await page.locator("#download").click();
  await expect.poll(() => counter(page)).toBe(6);
});

test("cancelling a running download keeps what was handed over, consumes nothing more, clears the selection", async ({ page }) => {
  await recordDownloads(page);
  await open(page, 5);
  await selectMode(page);
  await page.locator("#dl-all").click();
  await page.locator("#dl-go").click();
  await expect.poll(async () => (await anchors(page)).length).toBeGreaterThanOrEqual(1);
  await page.locator("#dl-cancel").click();
  await expect(page.locator("#dl-bar")).toBeHidden();
  const done = (await anchors(page)).length;
  expect(done).toBeLessThan(5);
  await page.waitForTimeout(1200);
  expect((await anchors(page)).length).toBe(done); // nothing more after the cancellation
  expect(await counter(page)).toBe(done);
  await expect(page.locator("#gallery-status")).toContainText("annulé");
  await expect(page.locator("#gallery .is-selected")).toHaveCount(0);
});

test("touch phone: 'Préparer' then 'Partager' with the named files; the counter moves only after the share", async ({ page }) => {
  await touchShare(page);
  await recordDownloads(page);
  await open(page, 4);
  await selectMode(page);
  await page.locator("#dl-all").click();
  await expect(page.locator("#dl-go")).toHaveText("Préparer 4 photos");
  await page.locator("#dl-go").click();
  await expect(page.locator("#dl-go")).toHaveText("Partager 4 photos");
  expect(await page.evaluate(() => window.__shared.length)).toBe(0); // preparing never opens the share sheet
  expect(await counter(page)).toBe(0);
  await page.locator("#dl-go").click();
  await expect(page.locator("#dl-bar")).toBeHidden();
  expect(await page.evaluate(() => window.__shared)).toEqual([[1, 2, 3, 4].map((n) => `${NAME(n)}|image/jpeg|true`)]);
  expect(await counter(page)).toBe(4);
  expect(await anchors(page)).toEqual([]);
  await expect(page.locator("#gallery-status")).toContainText("4 photos partagées.");
  await expect(page.locator("#gallery .is-selected")).toHaveCount(0);
});

test("touch phone: a dismissed share consumes no number and can be tried again", async ({ page }) => {
  await touchShare(page, "abort-once");
  await open(page, 3);
  await selectMode(page);
  await page.locator("#dl-all").click();
  await page.locator("#dl-go").click();
  await page.locator("#dl-go").click();
  await expect(page.locator("#dl-note")).toContainText("Partage annulé");
  expect(await counter(page)).toBe(0);
  await expect(page.locator("#dl-count")).toHaveText("3 photos sélectionnées");
  await expect(page.locator("#dl-go")).toHaveText("Partager 3 photos");
  await page.locator("#dl-go").click();
  await expect(page.locator("#dl-bar")).toBeHidden();
  expect(await counter(page)).toBe(3);
  const shared = await page.evaluate(() => window.__shared);
  expect(shared[1].map((s) => s.split("|")[0])).toEqual([NAME(1), NAME(2), NAME(3)]);
});

test("touch phone: a failing share falls back to successive downloads without gap in the numbering", async ({ page }) => {
  await touchShare(page, "fail");
  await recordDownloads(page);
  await open(page, 3);
  await selectMode(page);
  await page.locator("#dl-all").click();
  await page.locator("#dl-go").click();
  await page.locator("#dl-go").click();
  await expect(page.locator("#dl-bar")).toBeHidden({ timeout: 15000 });
  expect(await anchors(page)).toEqual([NAME(1), NAME(2), NAME(3)]);
  expect(await counter(page)).toBe(3);
});

test("touch phone: if the files cannot be fetched (network, CORS) the downloads take over", async ({ page }) => {
  await touchShare(page);
  await recordDownloads(page);
  await open(page, 2);
  // Only the plain fetch of the file fails; the signed download URL (?download=1) still answers.
  await page.route(/\/fixtures\/photo_01\.jpg$/, (route) => route.abort());
  await selectMode(page);
  await page.locator("#dl-all").click();
  await page.locator("#dl-go").click();
  await expect(page.locator("#dl-bar")).toBeHidden({ timeout: 15000 });
  expect(await page.evaluate(() => window.__shared.length)).toBe(0);
  expect(await anchors(page)).toEqual([NAME(1), NAME(2)]);
  expect(await counter(page)).toBe(2);
});

test("a photo Storage refuses (not public any more) is never downloaded and consumes no number", async ({ page }) => {
  await recordDownloads(page);
  await open(page, 3);
  await page.evaluate(() => { mock.signRefused = true; });
  await selectMode(page);
  await page.locator("#dl-all").click();
  await page.locator("#dl-go").click();
  await expect(page.locator("#gallery-status")).toContainText("3 photos n’ont pas pu être téléchargées", { timeout: 15000 });
  expect(await anchors(page)).toEqual([]);
  expect(await counter(page)).toBe(0);
});

test("only the public photos of the gallery can be selected, and only their own paths are signed", async ({ page }) => {
  await recordDownloads(page);
  await open(page, 3, { maries: 2 });
  await expect(cards(page)).toHaveCount(3);
  await selectMode(page);
  await page.locator("#dl-all").click();
  await expect(page.locator("#dl-count")).toHaveText("3 photos sélectionnées");
  await page.locator("#dl-go").click();
  await expect(page.locator("#dl-bar")).toBeHidden({ timeout: 15000 });
  const paths = await page.evaluate(() => mock.calls.filter((c) => c[0] === "sign").map((c) => c[1]));
  expect(paths).toHaveLength(3);
  for (const path of paths) expect(path).toMatch(/^public\/full\//);
});

for (const width of [360, 375, 390, 412, 768]) {
  test(`selection mode at ${width}px: no horizontal overflow, bar and buttons usable`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 768 ? 1024 : 800 });
    await open(page, 25);
    await selectMode(page);
    await page.locator("#dl-all").click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    for (const id of ["dl-go", "dl-all", "dl-cancel"]) {
      const box = await page.locator(`#${id}`).boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    await expect(page.locator("#fab-bar")).toBeHidden();
    if (width === 375 || width === 412) {
      await cards(page).nth(0).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/batch-${width}.png` });
    }
  });
}

test("home at 375x667: the 'Partager mes photos' button stays 58x319 and visible without scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await open(page, 3);
  const box = await page.locator(".hero-cta").boundingBox();
  expect(Math.round(box.height)).toBe(58);
  expect(Math.round(box.width)).toBe(319);
  expect(box.y + box.height).toBeLessThanOrEqual(667);
});

test("accessibility (axe) of the selection mode: names, contrast, pressed state", async ({ page }) => {
  await open(page, 6);
  await selectMode(page);
  await cards(page).nth(0).click();
  await page.waitForTimeout(1500); // entrance animations settled
  expect((await new AxeBuilder({ page }).include("#gallery-view").include("#dl-bar").analyze()).violations).toEqual([]);
});
