// Point 3: burger menu under 768 px on the guest pages (home and legal pages), nothing changes from 768 px up.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installMock } from "./mock.js";

const PAGES = ["/", "/confidentialite", "/conditions-utilisation"];
const toggle = (page) => page.locator("#menu-toggle");
const links = (page) => page.locator("#site-menu a");
async function open(page, path = "/", scheme = "light", width = 375) {
  await page.setViewportSize({ width, height: 800 });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  await installMock(page, { photos: 3 });
  await page.goto(path);
}

for (const path of PAGES)
  test(`${path}: under 768 px the links sit in a menu opened by a 44 px burger`, async ({ page }) => {
    await open(page, path);
    await expect(toggle(page)).toBeVisible();
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
    await expect(toggle(page)).toHaveAttribute("aria-label", "Ouvrir le menu");
    await expect(toggle(page)).toHaveAttribute("aria-controls", "site-menu");
    const box = await toggle(page).boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await expect(links(page).first()).toBeHidden();
    // The logo and the theme button stay in the header.
    await expect(page.locator(".wordmark")).toBeVisible();
    await expect(page.locator("#theme-toggle")).toBeVisible();
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(toggle(page)).toHaveAttribute("aria-label", "Fermer le menu");
    await expect(links(page)).toHaveCount(3);
    for (const link of await links(page).all()) {
      await expect(link).toBeVisible();
      expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
    // The page behind does not scroll while the menu is open.
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");
  });

test("closes on a tap on a link (and the link still works), outside the menu, and on Escape", async ({ page }) => {
  await open(page, "/");
  await toggle(page).click();
  await page.locator("#site-menu").getByRole("link", { name: "Partager des photos", exact: true }).click();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(page).toHaveURL(/#partager$/);
  await expect(page.locator("#share-view")).toBeVisible();

  await toggle(page).click();
  await page.mouse.click(200, 700); // outside the menu panel
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");

  await toggle(page).click();
  await page.keyboard.press("Escape");
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(toggle(page)).toBeFocused();
});

test("legal page: a link of the menu navigates", async ({ page }) => {
  await open(page, "/confidentialite");
  await toggle(page).click();
  await page.locator("#site-menu").getByRole("link", { name: "Accueil", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("the current page is still marked in the menu on the home page", async ({ page }) => {
  await open(page, "/");
  await toggle(page).click();
  await expect(page.locator("#site-menu [aria-current=page]")).toHaveCount(1);
});

for (const width of [768, 1024, 1440])
  test(`from ${width}px: no burger, the links stay inline as before`, async ({ page }) => {
    await open(page, "/", "light", width);
    await expect(toggle(page)).toBeHidden();
    for (const link of await links(page).all()) await expect(link).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  });

test("the header is not taller than before (77 px) and the home button is unchanged at 375x667", async ({ page }) => {
  await open(page, "/");
  await page.setViewportSize({ width: 375, height: 667 });
  const header = await page.locator(".site-header").boundingBox();
  expect(header.height).toBeLessThanOrEqual(77.5);
  const cta = await page.locator(".hero-cta").boundingBox();
  expect(Math.round(cta.height)).toBe(58);
  expect(Math.round(cta.width)).toBe(319);
  expect(cta.y + cta.height).toBeLessThanOrEqual(667);
});

for (const scheme of ["light", "dark"]) {
  for (const width of [360, 375, 390, 412, 767, 768])
    test(`${scheme} at ${width}px: no horizontal overflow, menu closed and open, every page`, async ({ page }) => {
      for (const path of PAGES) {
        await open(page, path, scheme, width);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
        if (await toggle(page).isVisible()) {
          await toggle(page).click();
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
          const panel = await page.locator("#site-menu").boundingBox();
          expect(panel.x).toBeGreaterThanOrEqual(0);
          expect(panel.x + panel.width).toBeLessThanOrEqual(width);
        }
      }
    });

  test(`${scheme}: axe on every page, menu closed and open`, async ({ page }) => {
    for (const path of PAGES) {
      await open(page, path, scheme);
      await page.waitForTimeout(1200);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await toggle(page).click();
      await page.waitForTimeout(300);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
  });

  test(`${scheme}: the open menu has no light surface in dark`, async ({ page }) => {
    await open(page, "/", scheme);
    await toggle(page).click();
    const bg = await page.locator("#site-menu").evaluate((n) => getComputedStyle(n).backgroundColor);
    const lum = (c) => { const [r, g, b] = c.match(/[\d.]+/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
    if (scheme === "dark") expect(lum(bg)).toBeLessThan(0.2);
    else expect(lum(bg)).toBeGreaterThan(0.8);
  });
}

test("the administration is untouched", async ({ page }) => {
  await installMock(page);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/admin");
  expect(await page.locator("#menu-toggle").count()).toBe(0);
});

test("no inline script and no CSP violation: menu.js is an external, blocking script in <head>", async ({ page }) => {
  const violations = [];
  page.on("console", (message) => /content security policy/i.test(message.text()) && violations.push(message.text()));
  for (const path of PAGES) {
    await open(page, path);
    await toggle(page).click();
    const info = await page.evaluate(() => ({
      inline: [...document.scripts].filter((s) => !s.src).length,
      menu: !!document.querySelector('head script[src$="menu.js"]'),
    }));
    expect(info).toEqual({ inline: 0, menu: true });
  }
  expect(violations).toEqual([]);
});
