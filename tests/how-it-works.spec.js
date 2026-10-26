// "Comment ça marche ?" block on the home page: three steps in guest language, a small print, and the main
// button still visible without scrolling.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installMock } from "./mock.js";

async function open(page, scheme, width, height = 667) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  await installMock(page, { photos: 3 });
  await page.goto("/");
  await expect(page.locator("#gallery .photo-card")).toHaveCount(3);
}

test("the block is on the home page with its three steps and its small print", async ({ page }) => {
  await open(page, "light", 375);
  const block = page.locator("#how-it-works");
  await expect(block.getByRole("heading", { level: 2 })).toHaveText("Comment ça marche ?");
  const steps = block.locator("ol > li");
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toContainText("Partagez vos photos");
  await expect(steps.nth(0)).toContainText("Touchez « Partager mes photos », choisissez-les, puis envoyez.");
  await expect(steps.nth(1)).toContainText("Public ou privé");
  await expect(steps.nth(1)).toContainText("Vous choisissez si elles sont visibles par tous les invités ou seulement par les mariés.");
  await expect(steps.nth(2)).toContainText("Retrouvez-les");
  await expect(steps.nth(2)).toContainText("Sur iPhone, touchez « Partager » puis « Enregistrer l’image » (elles arrivent dans Photos). Sur Android, elles vont dans Téléchargements.");
  const small = block.locator(".how-small");
  await expect(small).toContainText("Les photos publiques restent téléchargeables jusqu’au 20 novembre 2026.");
  await expect(small).toContainText("Sur Android, si Chrome demande « Autoriser plusieurs téléchargements », touchez « Autoriser ».");
  // It sits below the main button, after the hero.
  const cta = await page.locator(".hero-cta").boundingBox();
  const b = await block.boundingBox();
  expect(b.y).toBeGreaterThan(cta.y + cta.height);
});

for (const scheme of ["light", "dark"])
  for (const width of [360, 375])
    test(`${scheme} at ${width}px: 'Partager mes photos' stays visible without scrolling, unchanged in size`, async ({ page }) => {
      await open(page, scheme, width, 667);
      const cta = await page.locator(".hero-cta").boundingBox();
      expect(cta.y + cta.height).toBeLessThanOrEqual(667);
      expect(Math.round(cta.height)).toBe(58);
      if (width === 375) expect(Math.round(cta.width)).toBe(319);
    });

for (const scheme of ["light", "dark"])
  for (const width of [360, 375, 390, 412, 768])
    test(`${scheme} at ${width}px: the block does not overflow and stays readable`, async ({ page }) => {
      await open(page, scheme, width, 800);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      const b = await page.locator("#how-it-works").boundingBox();
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(width);
      const size = await page.locator("#how-it-works .how-small").evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
      expect(size).toBeGreaterThanOrEqual(13);
    });

for (const scheme of ["light", "dark"])
  test(`${scheme}: axe (contrast, structure) with the block`, async ({ page }) => {
    await open(page, scheme, 375, 800);
    await page.locator("#how-it-works").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

test("the block is absent from the other pages (administration, legal pages)", async ({ page }) => {
  await installMock(page);
  for (const path of ["/admin", "/confidentialite", "/conditions-utilisation"]) {
    await page.goto(path);
    expect(await page.locator("#how-it-works").count()).toBe(0);
  }
});
