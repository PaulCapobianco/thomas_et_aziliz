// No frame around a control after a tap or a click; the keyboard keeps a visible ring (AA contrast, both themes).
import { test, expect } from "@playwright/test";
import { installMock } from "./mock.js";
import { phone } from "./share-helpers.js";

async function open(page, scheme, width = 375, photos = 4) {
  await page.setViewportSize({ width, height: 800 });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  await phone(page);
  await installMock(page, { photos });
  await page.goto("/");
  await expect(page.locator("#gallery .photo-card")).toHaveCount(photos);
}
const ring = (locator) =>
  locator.evaluate((node) => {
    const s = getComputedStyle(node);
    return { style: s.outlineStyle, width: parseFloat(s.outlineWidth), color: s.outlineColor, shadow: s.boxShadow };
  });
const noRing = (r) => r.style === "none" || r.width === 0;
// WCAG contrast of two colours given as "rgb(a)" strings.
const contrast = (a, b) => {
  const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
  const lum = ([r, g, b]) => { const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
// Nearest opaque background colour behind the RING of a node (the ring sits outside the control, so its own
// fill does not count; the page colour is used when the parents paint a gradient or an image).
const backdrop = (locator) =>
  locator.evaluate((node) => {
    for (let n = node.parentElement; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      const alpha = c.startsWith("rgba") ? parseFloat(c.split(",")[3]) : 1;
      if (alpha > 0.9) return c;
    }
    return getComputedStyle(document.body).backgroundColor;
  });
// Tabs from the top of the page until `locator` is focused (keyboard modality, so :focus-visible applies).
async function tabTo(page, locator) {
  await page.evaluate(() => { window.scrollTo(0, 0); document.activeElement?.blur(); });
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Tab");
    if (await locator.evaluate((node) => node === document.activeElement)) return;
  }
  throw new Error("element never reached with Tab");
}

for (const scheme of ["light", "dark"]) {
  test(`${scheme}: no ring after a click on the burger, theme, select, hero button`, async ({ page }) => {
    await open(page, scheme);
    for (const selector of ["#theme-toggle", "#select-mode", "#menu-toggle"]) {
      await page.locator(selector).scrollIntoViewIfNeeded();
      await page.locator(selector).click();
      expect(noRing(await ring(page.locator(selector))), selector).toBeTruthy();
      // Entering the selection mode moves the focus to "Tout sélectionner": still no ring for a pointer user.
      if (selector === "#select-mode") expect(noRing(await ring(page.locator("#dl-all")))).toBeTruthy();
    }
    await page.keyboard.press("Escape"); // close the menu
    await page.locator("#select-mode").click(); // leave the selection mode
    const cta = page.locator(".hero-cta");
    await cta.scrollIntoViewIfNeeded();
    await cta.click();
    expect(noRing(await ring(cta))).toBeTruthy();
  });

  test(`${scheme}: no ring after a click on cards, the lightbox buttons and a destination`, async ({ page }) => {
    await open(page, scheme);
    const card = page.locator("#gallery .photo-card").first();
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await expect(page.locator("#lightbox")).toBeVisible();
    // The dialog moves the focus to its close button when it opens: that is not a keyboard focus.
    for (const selector of ["#close-lightbox", "#download", "#report-open"]) {
      await page.locator(selector).focus();
      await page.locator(selector).click({ trial: true });
    }
    await page.locator("#next").click();
    expect(noRing(await ring(page.locator("#next")))).toBeTruthy();
    await page.locator("#download").click();
    expect(noRing(await ring(page.locator("#download")))).toBeTruthy();
    await page.keyboard.press("Escape");
    await page.goto("/#partager");
    const destination = page.locator("[data-destination=public]");
    await page.evaluate(() => { document.querySelector("[data-destination=public]").addEventListener("click", (e) => e.stopImmediatePropagation(), true); });
    await destination.click();
    expect(noRing(await ring(destination))).toBeTruthy();
  });

  test(`${scheme}: no tap highlight box on buttons and links`, async ({ page }) => {
    await open(page, scheme);
    const values = await page.evaluate(() =>
      ["#theme-toggle", "#menu-toggle", "#select-mode", ".hero-cta", "#gallery .photo-card", ".wordmark"].map((selector) => {
        const node = document.querySelector(selector);
        return [selector, getComputedStyle(node).webkitTapHighlightColor];
      }),
    );
    for (const [selector, color] of values) expect(color, selector).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  });

  test(`${scheme}: the keyboard keeps a visible ring with AA contrast`, async ({ page }) => {
    await open(page, scheme, 1024); // inline nav: links reachable
    const targets = ["#theme-toggle", ".wordmark", "#select-mode", ".hero-cta", "#gallery .photo-card"];
    for (const selector of targets) {
      const locator = page.locator(selector).first();
      await tabTo(page, locator);
      const r = await ring(locator);
      expect(r.style, selector).toBe("solid");
      expect(r.width, selector).toBeGreaterThanOrEqual(2);
      const bg = await backdrop(locator);
      // Non-text contrast (3:1), here with a good margin on the page colours.
      expect(contrast(r.color, bg), `${selector} ${r.color} on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  test(`${scheme}: the burger and the lightbox buttons get a ring from the keyboard`, async ({ page }) => {
    await open(page, scheme, 375);
    const burger = page.locator("#menu-toggle");
    await tabTo(page, burger);
    const r = await ring(burger);
    expect(r.style).toBe("solid");
    expect(contrast(r.color, await backdrop(burger))).toBeGreaterThanOrEqual(3);
    // A click, then the keyboard: the ring comes back on the next focused control.
    await page.locator("#theme-toggle").click();
    expect(noRing(await ring(page.locator("#theme-toggle")))).toBeTruthy();
    await page.keyboard.press("Tab");
    await expect(burger).toBeFocused();
    expect((await ring(burger)).style).toBe("solid");
    // Lightbox: ring from the keyboard on the white-on-dark bar.
    await page.locator("#menu-toggle").focus();
    await page.keyboard.press("Escape");
    await page.locator("#gallery .photo-card").first().scrollIntoViewIfNeeded();
    await page.locator("#gallery .photo-card").first().click();
    await expect(page.locator("#lightbox")).toBeVisible();
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => document.activeElement.id || document.activeElement.className);
    expect(focused).toBeTruthy();
    const active = page.locator(":focus");
    const rl = await ring(active);
    expect(rl.style).toBe("solid");
    expect(contrast(rl.color, await backdrop(active)), `lightbox ring ${rl.color}`).toBeGreaterThanOrEqual(3);
  });
}

test("the administration does not load the touch/focus rules", async ({ page }) => {
  await installMock(page);
  await page.goto("/admin");
  expect(await page.locator('link[href$="theme.css"]').count()).toBe(0);
  expect(await page.locator('script[src$="menu.js"], script[src$="theme.js"]').count()).toBe(0);
});

// The real cause of the frame seen on phones: a tap leaves :hover on the control, and app.css draws a frame or a
// fill on :hover. On a touch screen, hovering a control must not change how it looks.
for (const scheme of ["light", "dark"])
  test(`${scheme}: a tap leaves no hover look on a touch screen (frame, fill, colour)`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 800 }, reducedMotion: "reduce", colorScheme: scheme, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await installMock(page, { photos: 4 });
    const snap = (locator) => locator.evaluate((n) => { const s = getComputedStyle(n); return [s.borderTopColor, s.backgroundColor, s.color].join("|"); });
    const changed = [];
    async function scan(selector) {
      const all = page.locator(selector);
      for (let i = 0; i < (await all.count()); i++) {
        const el = all.nth(i);
        if (!(await el.isVisible())) continue;
        await page.mouse.move(2, 2);
        const before = await snap(el);
        try { await el.hover({ timeout: 1500 }); } catch { continue; }
        if ((await snap(el)) !== before) changed.push(await el.evaluate((n) => n.tagName + "#" + n.id + "." + n.className));
      }
    }
    await page.goto("/");
    await expect(page.locator("#gallery .photo-card")).toHaveCount(4);
    await scan("header a, header button, .hero a, .hero button, #select-mode, #refresh, .site-footer a");
    await page.locator("#select-mode").tap();
    await page.locator("#gallery .photo-card").first().tap();
    await scan("#dl-bar button");
    await page.locator("#dl-cancel").tap();
    await page.locator("#gallery .photo-card").first().tap();
    await scan("#lightbox button");
    await page.keyboard.press("Escape");
    await page.goto("/confidentialite");
    await scan("header a, header button, main a, .site-footer a, .button");
    expect(changed).toEqual([]);
    await context.close();
  });

// The programmatic focus on arrival (app.js moves the focus to the page title, or to <main>, for screen readers):
// a heading is not an operable control, so it never needs a ring. Some phones match :focus-visible for a script
// focus with no pointer before it, and drew the browser's default frame around the title.
for (const scheme of ["light", "dark"])
  test(`${scheme}: no frame around the title or the page when the focus moves there on arrival`, async ({ page }) => {
    await open(page, scheme);
    await page.keyboard.press("Shift"); // keyboard modality: the situation where :focus-visible matches a script focus
    await page.evaluate(() => { location.hash = "#partager"; });
    await expect(page.locator("#share-view")).toBeVisible();
    const title = await page.evaluate(() => {
      const a = document.activeElement, s = getComputedStyle(a);
      return { id: a.id, outline: s.outlineStyle, width: parseFloat(s.outlineWidth), shadow: s.boxShadow };
    });
    expect(title.id).toBe("share-title");
    expect(title.outline === "none" || title.width === 0).toBeTruthy();
    await page.evaluate(() => { location.hash = "#galerie"; });
    await expect(page.locator("#gallery-view")).toBeVisible();
    const main = await page.evaluate(() => {
      const a = document.activeElement, s = getComputedStyle(a);
      return { id: a.id, outline: s.outlineStyle, width: parseFloat(s.outlineWidth) };
    });
    expect(main.id).toBe("main");
    expect(main.outline === "none" || main.width === 0).toBeTruthy();
  });

test("these elements are not in the Tab order, so the keyboard ring on real controls is untouched", async ({ page }) => {
  await open(page, "light", 1024);
  const tabindex = await page.evaluate(() => [document.getElementById("share-title").getAttribute("tabindex"), document.getElementById("main").getAttribute("tabindex")]);
  expect(tabindex).toEqual(["-1", "-1"]);
  await page.evaluate(() => { location.hash = "#partager"; });
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  // A real control reached with Tab still shows its ring (the control tests above check colour and contrast).
  const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return [document.activeElement.tagName, s.outlineStyle, parseFloat(s.outlineWidth)]; });
  expect(ring[1]).toBe("solid");
  expect(ring[2]).toBeGreaterThanOrEqual(2);
});

// "Sélectionner" then the focus: a tap must not move the focus to "Tout sélectionner" (some phones draw a frame
// around a control focused by script); the keyboard keeps the move, and its ring.
for (const scheme of ["light", "dark"]) {
  test(`${scheme}: a tap on "Sélectionner" leaves the focus alone; no frame on "Tout sélectionner"`, async ({ page }) => {
    await open(page, scheme);
    await page.locator("#select-mode").scrollIntoViewIfNeeded();
    await page.locator("#select-mode").tap().catch(() => page.locator("#select-mode").click());
    await expect(page.locator("#dl-bar")).toBeVisible();
    const state = await page.evaluate(() => ({ active: document.activeElement.id, ring: getComputedStyle(document.getElementById("dl-all")).outlineStyle }));
    expect(state.active).not.toBe("dl-all");
    expect(state.ring === "none").toBeTruthy();
    // Leaving the selection by a tap does not move the focus either.
    await page.locator("#dl-cancel").click();
    expect(await page.evaluate(() => document.activeElement.id)).not.toBe("select-mode");
  });

  test(`${scheme}: with the keyboard, "Sélectionner" moves the focus to "Tout sélectionner" and shows its ring`, async ({ page }) => {
    await open(page, scheme, 1024);
    await tabTo(page, page.locator("#select-mode"));
    await page.keyboard.press("Enter");
    await expect(page.locator("#dl-all")).toBeFocused();
    const r = await ring(page.locator("#dl-all"));
    expect(r.style).toBe("solid");
    expect(r.width).toBeGreaterThanOrEqual(2);
    // Escape-free exit with the keyboard: the focus returns to the "Sélectionner" button.
    await page.locator("#dl-cancel").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#select-mode")).toBeFocused();
  });
}
