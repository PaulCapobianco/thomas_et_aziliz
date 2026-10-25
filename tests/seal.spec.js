// Tampon T&A : l'anneau de texte pivote exactement sur le centre du sceau (WebKit résolvait mal transform-origin :
// l'anneau décrivait un petit cercle de 6 à 7 px autour du monogramme), le monogramme reste fixe et centré.
import { test, expect } from "@playwright/test";
import { installMock } from "./mock.js";

const WIDTHS = [360, 375, 390, 412, 768];
// L'apparition du tampon (opacité et échelle, ~3 s après le chargement) doit être terminée avant toute mesure.
const settled = (page) =>
  expect
    .poll(() => page.locator(".seal").evaluate((node) => { const css = getComputedStyle(node); return css.opacity === "1" && css.transform === "none"; }), { timeout: 8000 })
    .toBeTruthy();
const open = async (page, width, options = {}) => {
  await page.setViewportSize({ width, height: 800 });
  await installMock(page);
  if (options.reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".seal")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await settled(page);
};
const centers = (page, turn) =>
  page.evaluate((turn) => {
    for (const animation of document.getAnimations())
      if (animation.animationName === "seal-orbit") {
        animation.pause();
        animation.currentTime = turn * 40000;
      }
    const center = (selector) => {
      const box = document.querySelector(selector).getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2, w: box.width };
    };
    return { disc: center(".seal-disc"), ring: center(".seal-text"), mark: center(".seal-mark") };
  }, turn);

test.describe("monogramme", () => {
  // Zoom ×6 : à l'échelle CSS les traits fins du monogramme ne sortent pas assez sombres pour être mesurés.
  test.use({ deviceScaleFactor: 6 });
  for (const width of WIDTHS) {
    test(`tampon ${width}px : le monogramme T&A est centré dans le disque (encre mesurée)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await installMock(page);
      await page.goto("/");
      await page.evaluate(() => document.fonts.ready);
      await settled(page);
      await page.evaluate(() => { document.querySelector(".seal-text").style.visibility = "hidden"; });
      const png = await page.locator(".seal").screenshot();
      const ink = await page.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
        const image = new Image();
        image.src = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
        for (let y = 0; y < canvas.height; y++)
          for (let x = 0; x < canvas.width; x++) {
            if (Math.hypot(x - canvas.width / 2, y - canvas.height / 2) > canvas.width * 0.3) continue;
            const i = (y * canvas.width + x) * 4;
            if ((data[i] + data[i + 1] + data[i + 2]) / 3 < 130) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
          }
        const scale = devicePixelRatio;
        return { dx: ((x0 + x1) / 2 - canvas.width / 2) / scale, dy: ((y0 + y1) / 2 - canvas.height / 2) / scale, found: x1 > x0 };
      }, png.toString("base64"));
      expect(ink.found).toBeTruthy();
      expect(Math.abs(ink.dx)).toBeLessThanOrEqual(1.2);
      expect(Math.abs(ink.dy)).toBeLessThanOrEqual(1.2);
    });
  }
});

for (const width of WIDTHS) {
  test(`tampon ${width}px : l'anneau reste concentrique au sceau à 0, 90, 180 et 270 degrés`, async ({ page }) => {
    await open(page, width);
    for (const turn of [0, 0.25, 0.5, 0.75]) {
      const { disc, ring, mark } = await centers(page, turn);
      expect(Math.abs(ring.x - disc.x), `anneau x à ${turn} tour`).toBeLessThanOrEqual(0.6);
      expect(Math.abs(ring.y - disc.y), `anneau y à ${turn} tour`).toBeLessThanOrEqual(0.6);
      // Le monogramme ne bouge pas et son axe vertical passe par le centre du sceau.
      expect(Math.abs(mark.x - disc.x)).toBeLessThanOrEqual(1);
    }
    const mark = await centers(page, 0).then((c) => c.mark);
    const later = await centers(page, 0.5).then((c) => c.mark);
    expect(Math.abs(mark.x - later.x) + Math.abs(mark.y - later.y)).toBeLessThanOrEqual(0.05);
  });
}

test("tampon : rotation lente et régulière, tampon dans l'écran sans déborder", async ({ page }) => {
  await open(page, 375);
  const style = await page.locator(".seal-text").evaluate((node) => {
    const css = getComputedStyle(node);
    return { name: css.animationName, duration: css.animationDuration, timing: css.animationTimingFunction, count: css.animationIterationCount };
  });
  expect(style).toEqual({ name: "seal-orbit", duration: "40s", timing: "linear", count: "infinite" });
  const box = await page.locator(".seal").boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

for (const width of [375, 768]) {
  test(`tampon ${width}px : l'animation est coupée avec prefers-reduced-motion`, async ({ page }) => {
    await open(page, width, { reducedMotion: true });
    expect(await page.locator(".seal-text").evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
    expect(await page.evaluate(() => document.getAnimations().filter((a) => a.animationName === "seal-orbit").length)).toBe(0);
    const { disc, ring } = await centers(page, 0);
    expect(Math.abs(ring.x - disc.x)).toBeLessThanOrEqual(0.6);
    expect(Math.abs(ring.y - disc.y)).toBeLessThanOrEqual(0.6);
  });
}
