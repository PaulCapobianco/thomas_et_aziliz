// Error messages at the top of the screen: the upload error (the same component as the success and pending
// messages, which stay where they were) and the lightbox note (the message above its action bar).
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installMock } from "./mock.js";
import { phone, IPHONE } from "./share-helpers.js";

const box = (page, selector) => page.locator(selector).boundingBox();
const overlaps = (a, b) => !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);

async function failedUpload(page, scheme, width, height = 800) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  await installMock(page, { failures: 3, photos: 2 });
  await page.goto("/#partager");
  await page.locator("#files").setInputFiles(["fixtures/photo_01.jpg"]);
  await page.locator("[name=audience][value=public]").check();
  await expect(page.locator("#send")).toBeEnabled();
  await page.locator("#send").click();
  await expect(page.locator("#upload-message")).toHaveAttribute("data-kind", "error", { timeout: 30000 });
}

for (const scheme of ["light", "dark"])
  for (const [label, width, height] of [["375 px", 375, 800], ["desktop", 1280, 900]])
    test(`${scheme}, ${label}: the upload error is a banner at the top, below the header, inside the screen`, async ({ page }) => {
      await failedUpload(page, scheme, width, height);
      const message = page.locator("#upload-message");
      await expect(message).toBeVisible();
      const style = await message.evaluate((n) => { const s = getComputedStyle(n); return { position: s.position, top: parseFloat(s.top), z: s.zIndex }; });
      expect(style.position).toBe("fixed");
      const rect = await box(page, "#upload-message");
      const header = await box(page, ".site-header");
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeLessThan(160); // top of the screen
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(width);
      // The header, the theme button and the burger stay uncovered.
      expect(rect.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
      for (const selector of [".wordmark", "#theme-toggle", "#menu-toggle"]) {
        const b = await box(page, selector).catch(() => null);
        if (b && b.width) expect(overlaps(rect, b), selector).toBeFalsy();
      }
      // Readable: the text is inside the banner, the buttons are reachable, contrast is checked by axe elsewhere.
      await expect(page.locator("#upload-status")).toContainText("n’a pas pu être envoyée");
      await expect(page.locator("#message-retry")).toBeVisible();
      await expect(page.locator("#message-close")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    });

test("the banner stays announced (role status, polite) and goes away as before: only when closed", async ({ page }) => {
  await failedUpload(page, "light", 375);
  await expect(page.locator("#upload-status")).toHaveAttribute("role", "status");
  await expect(page.locator("#upload-status")).toHaveAttribute("aria-live", "polite");
  await page.waitForTimeout(6000); // an error never disappears by itself
  await expect(page.locator("#upload-message")).toHaveAttribute("data-kind", "error");
  await page.locator("#message-close").click();
  await expect(page.locator("#upload-message")).not.toHaveAttribute("data-kind", /.+/);
  await expect(page.locator("#upload-status")).toBeEmpty();
});

test("a success message stays where it was (inline), only the error moves", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await installMock(page, { photos: 2 });
  await page.goto("/#partager");
  await page.locator("#files").setInputFiles(["fixtures/photo_01.jpg"]);
  await page.locator("[name=audience][value=public]").check();
  await page.locator("#send").click();
  await expect(page.locator("#upload-message")).toHaveAttribute("data-kind", /success|pending/, { timeout: 30000 });
  expect(await page.locator("#upload-message").evaluate((n) => getComputedStyle(n).position)).not.toBe("fixed");
});

test("the safe area of the iPhone (notch) is respected by both banners", async ({ page }) => {
  await page.goto("/");
  const css = await page.evaluate(async () => (await (await fetch("/theme.css")).text()));
  const blocks = css.match(/\.upload-message\[data-kind="error"\][^{]*\{[^}]*\}/g) || [];
  expect(blocks.join("")).toContain("env(safe-area-inset-top");
  expect(css.match(/#lightbox \.save-note[^{]*\{[^}]*\}/g).join("")).toContain("env(safe-area-inset-top");
});

for (const scheme of ["light", "dark"])
  for (const [label, width, height] of [["375 px", 375, 667], ["desktop", 1280, 800]])
    test(`${scheme}, ${label}: the lightbox note is at the top, under the toolbar, never over the Close button`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await phone(page, { outcome: "fail", errorName: "NotAllowedError", ua: IPHONE });
      await installMock(page, { photos: 3 });
      await page.route(/\/fixtures\/photo_01\.jpg\?download=1$/, (route) => route.fulfill({ body: "x", contentType: "image/jpeg" }));
      await page.goto("/");
      await page.locator("#gallery .photo-card").first().click();
      await expect(page.locator("#save-photo")).toBeEnabled({ timeout: 10000 });
      await page.locator("#save-photo").click();
      await expect(page.locator("#save-note")).toContainText("refusé");
      const note = await box(page, "#save-note");
      const close = await box(page, "#close-lightbox");
      const actions = await box(page, "#lightbox-actions");
      expect(note.y).toBeLessThan(height / 3); // upper part of the screen
      expect(note.y + note.height).toBeLessThan(actions.y); // not on the bottom bar any more
      expect(overlaps(note, close)).toBeFalsy();
      expect(note.x).toBeGreaterThanOrEqual(0);
      expect(note.x + note.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => getComputedStyle(document.getElementById("save-note")).position)).toBe("fixed");
    });

for (const scheme of ["light", "dark"])
  test(`${scheme}: axe (contrast, names) with the error banner open at 375 px`, async ({ page }) => {
    await failedUpload(page, scheme, 375);
    await page.waitForTimeout(600);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
