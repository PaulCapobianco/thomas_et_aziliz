// Light / dark theme: default from the phone, toggle, memory (with blocked storage), no flash, admin untouched,
// contrast (axe) in both themes, no light surface left in dark, no overflow, hero button, photos unfiltered.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installMock } from "./mock.js";

const PAGES = ["/", "/confidentialite", "/conditions-utilisation"];
const theme = (page) => page.evaluate(() => document.documentElement.dataset.theme);

// Light surfaces: any visible box whose painted background (colour or gradient stops) is bright.
// Allowed: photos, and the objects that imitate paper or brass (frames, seal, selection tick).
function findLightSurfaces() {
  const parse = (text) => [...text.matchAll(/rgba?\(([^)]+)\)/g)].map((m) => m[1].split(/[ ,/]+/).filter(Boolean).map(Number));
  const lum = ([r, g, b]) => {
    const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const allowed = ".polaroid, .polaroid *, .seal, .seal *, .pick-box, img, svg, video, canvas, .photo-viewport, .photo-viewport *";
  const found = [];
  for (const node of document.querySelectorAll("body *")) {
    if (!node.getClientRects().length || node.matches(allowed)) continue;
    const style = getComputedStyle(node);
    if (style.visibility === "hidden" || style.display === "none") continue;
    const rect = node.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;
    const layers = [style.backgroundColor, style.backgroundImage].flatMap(parse);
    // Semi-transparent stops (<0.5) are glows over the dark base, not surfaces.
    const bright = layers.filter((c) => (c.length < 4 || c[3] >= 0.5) && lum(c) > 0.35);
    if (bright.length) found.push(`${node.tagName.toLowerCase()}${node.id ? "#" + node.id : ""}.${String(node.className).split(" ")[0]}`);
  }
  return [...new Set(found)];
}

async function openHome(page, scheme, options = {}) {
  await page.emulateMedia({ colorScheme: scheme });
  await installMock(page, { photos: 6, ...options });
  await page.goto("/");
  await expect(page.locator("#gallery .photo-card")).toHaveCount(options.photos ?? 6);
}

test("default theme follows the phone setting, on every guest page", async ({ page }) => {
  for (const scheme of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const path of PAGES) {
      await page.goto(path);
      expect(await theme(page)).toBe(scheme);
      await expect(page.locator("#theme-toggle")).toHaveAttribute("aria-pressed", String(scheme === "dark"));
    }
  }
});

test("the button switches, the choice is remembered across pages and reloads, and beats the phone setting", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/confidentialite");
  await page.locator("#theme-toggle").click();
  expect(await theme(page)).toBe("dark");
  expect(await page.evaluate(() => localStorage.getItem("wk_theme"))).toBe("dark");
  await page.reload();
  expect(await theme(page)).toBe("dark");
  await page.goto("/conditions-utilisation");
  expect(await theme(page)).toBe("dark");
  await page.locator("#theme-toggle").click();
  expect(await theme(page)).toBe("light");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  expect(await theme(page)).toBe("light"); // an explicit choice wins over the phone
});

test("blocked storage: the button still works and nothing throws", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new DOMException("blocked", "SecurityError"); } });
  });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.locator("#theme-toggle").click();
  expect(await theme(page)).toBe("dark");
  await page.locator("#theme-toggle").click();
  expect(await theme(page)).toBe("light");
  expect(errors).toEqual([]);
});

test("no flash: theme.js is a blocking script in <head>, before the stylesheets, and sets the theme at once", async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(path);
    const info = await page.evaluate(() => {
      const script = document.querySelector('head script[src$="theme.js"]');
      const css = document.querySelector('head link[href$="app.css"]');
      return {
        before: !!script && !!(script.compareDocumentPosition(css) & Node.DOCUMENT_POSITION_FOLLOWING),
        blocking: !script.defer && !script.async && script.type !== "module",
        themeCssAfterApp: !!(css.compareDocumentPosition(document.querySelector('head link[href$="theme.css"]')) & Node.DOCUMENT_POSITION_FOLLOWING),
      };
    });
    expect(info).toEqual({ before: true, blocking: true, themeCssAfterApp: true });
  }
});

test("the administration is untouched by the theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await installMock(page);
  await page.goto("/admin");
  expect(await theme(page)).toBeUndefined();
  expect(await page.locator("#theme-toggle").count()).toBe(0);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(246, 241, 230)");
});

for (const scheme of ["light", "dark"])
  test(`axe contrast and names, ${scheme} theme, every guest page`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await installMock(page, { photos: 6 });
    for (const path of PAGES) {
      await page.goto(path);
      if (path === "/") await expect(page.locator("#gallery .photo-card")).toHaveCount(6);
      await page.waitForTimeout(1800); // entrance animations settled
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
    // Share view and selection mode too.
    await page.goto("/#partager");
    await page.waitForTimeout(800);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.goto("/");
    await page.locator("#select-mode").click();
    await page.locator("#gallery .photo-card").first().click();
    await page.waitForTimeout(800);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

test("dark theme leaves no light surface: home, share view, selection bar, lightbox, legal pages", async ({ page }) => {
  await openHome(page, "dark");
  await page.waitForTimeout(1800);
  expect(await page.evaluate(findLightSurfaces)).toEqual([]);
  await page.locator("#select-mode").click();
  await page.locator("#gallery .photo-card").first().click();
  expect(await page.evaluate(findLightSurfaces)).toEqual([]);
  await page.locator("#dl-cancel").click();
  await page.locator("#gallery .photo-card").first().click();
  await expect(page.locator("#lightbox")).toBeVisible();
  expect(await page.evaluate(findLightSurfaces)).toEqual([]);
  await page.keyboard.press("Escape");
  await page.goto("/#partager");
  await page.waitForTimeout(800);
  expect(await page.evaluate(findLightSurfaces)).toEqual([]);
  for (const path of ["/confidentialite", "/conditions-utilisation"]) {
    await page.goto(path);
    expect(await page.evaluate(findLightSurfaces)).toEqual([]);
  }
});

test("photos are never filtered or dimmed by the theme", async ({ page }) => {
  await openHome(page, "dark");
  const filters = await page.evaluate(() =>
    [...document.querySelectorAll("#gallery img, .hero-photo, .polaroid img")].map((img) => {
      const s = getComputedStyle(img);
      return [s.filter, s.mixBlendMode, s.opacity].join("|");
    }),
  );
  expect(filters.length).toBeGreaterThan(0);
  for (const f of filters) expect(f).toBe("none|normal|1");
  await page.locator("#gallery .photo-card").first().click();
  const lightbox = await page.evaluate(() => { const s = getComputedStyle(document.getElementById("full-photo")); return [s.filter, s.opacity].join("|"); });
  expect(lightbox).toBe("none|1");
});

for (const scheme of ["light", "dark"])
  for (const width of [360, 375, 390, 412, 768])
    test(`${scheme} theme at ${width}px: no horizontal overflow, theme button 44px and inside the header`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      for (const path of PAGES) {
        await page.emulateMedia({ colorScheme: scheme });
        await installMock(page, { photos: 3 });
        await page.goto(path);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
        const box = await page.locator("#theme-toggle").boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
    });

for (const scheme of ["light", "dark"])
  test(`${scheme} theme at 375x667: 'Partager mes photos' stays 58x319 and visible without scrolling`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openHome(page, scheme, { photos: 3 });
    const box = await page.locator(".hero-cta").boundingBox();
    expect(Math.round(box.height)).toBe(58);
    expect(Math.round(box.width)).toBe(319);
    expect(box.y + box.height).toBeLessThanOrEqual(667);
  });

// Scrolls the whole page once so the reveal animations and the lazy images are done before a full-page capture.
async function revealAll(page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 500) {
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700);
}

test("captures: every guest page, light and dark, at 375 and 412 px", async ({ page }, info) => {
  test.skip(info.project.name !== "chromium", "captures are taken once");
  test.setTimeout(240000);
  for (const width of [375, 412])
    for (const scheme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ colorScheme: scheme });
      await installMock(page, { photos: 6 });
      for (const [name, path] of [["accueil", "/"], ["partager", "/#partager"], ["confidentialite", "/confidentialite"], ["conditions", "/conditions-utilisation"]]) {
        await page.goto(path);
        if (path === "/") await expect(page.locator("#gallery .photo-card")).toHaveCount(6);
        await page.waitForTimeout(1500);
        await revealAll(page);
        await page.screenshot({ path: `test-results/theme-${name}-${scheme}-${width}.png`, fullPage: true });
      }
      await page.goto("/");
      await page.locator("#gallery .photo-card").first().click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: `test-results/theme-visionneuse-${scheme}-${width}.png` });
      await page.keyboard.press("Escape");
      await page.locator("#select-mode").click();
      await page.locator("#dl-all").click();
      await page.screenshot({ path: `test-results/theme-selection-${scheme}-${width}.png` });
    }
});
