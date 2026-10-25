import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installMock } from "./mock.js";

for (const width of [390, 768, 1440]) {
  test(`ivory design: original portraits, navigation and three screens at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await installMock(page, { admin: true });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(".hero-cta")).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Les photos de notre mariage");
    await expect(page.locator("#gallery .photo-card")).toHaveCount(0);
    await expect(page.locator(".polaroid img")).toHaveCount(7);
    // Decode every original, including the offscreen part of the horizontal strip.
    const images = await page.locator(".hero-photo, .polaroid img").evaluateAll(async (nodes) => {
      nodes.forEach((image) => { image.loading = "eager"; });
      await Promise.all(nodes.map((image) => image.decode()));
      return nodes.map((image) => ({ loaded: image.naturalWidth > 0, path: image.getAttribute("src") }));
    });
    expect(images.every((image) => image.loaded && image.path.startsWith("assets/couple/"))).toBeTruthy();
    expect(new Set(images.map((image) => image.path)).size).toBe(7);
    const capture = async (screen) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      await expect(page.locator("h1:visible")).toHaveCount(1);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({ path: info.outputPath(`${screen}-${width}.png`), fullPage: true });
    };
    await capture("home");
    await page.getByRole("link", { name: "Partager des photos", exact: true }).click();
    // Step 1: destination cards, nothing preselected, no file chooser. Step 2 after picking files from a card.
    await expect(page.locator("[name=audience]:checked")).toHaveCount(0);
    await expect(page.locator("#choose-step")).toBeVisible();
    await expect(page.locator("#send-bar")).toBeHidden();
    await capture("share-choice");
    const chooser = page.waitForEvent("filechooser");
    await page.locator("[data-destination=maries]").click();
    await (await chooser).setFiles(["fixtures/photo_01.jpg"]);
    await expect(page.locator("#send-bar")).toBeVisible();
    await expect(page.locator("[value=maries]")).toBeChecked();
    const bar = await page.locator("#send-bar").boundingBox();
    expect(Math.round(bar.y + bar.height)).toBe(900);
    await capture("share-private");
    await page.getByRole("link", { name: "Galerie", exact: true }).click();
    await expect(page.locator("#gallery-view")).toBeVisible();
    await expect(page.locator("nav [aria-current=page]")).toHaveCount(1);
    await expect(page.locator("nav [aria-current=page]")).toHaveText("Galerie");
    await expect(page.locator("#souvenirs")).toBeInViewport();
    await page.goto("/admin.html");
    await expect(page.locator("#dashboard")).toBeVisible();
    await capture("admin");
    expect(errors).toEqual([]);
  });

  test(`populated gallery, lightbox and moderation layout at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await installMock(page, { photos: 6, admin: true });
    await page.goto("/#souvenirs");
    await expect(page.locator("#gallery .photo-card")).toHaveCount(6);
    await page.locator("#gallery").scrollIntoViewIfNeeded();
    await expect.poll(() => page.locator("#gallery img").evaluateAll((images) =>
      images.every((image) => image.complete && image.naturalWidth > 0),
    )).toBeTruthy();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.locator("#souvenirs").screenshot({ path: info.outputPath(`gallery-mock-${width}.png`) });
    await page.locator(".photo-card").first().click();
    await expect(page.locator("#full-photo")).toBeVisible();
    await expect(page.locator("#lightbox-status")).toHaveText("");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`lightbox-mock-${width}.png`) });
    await page.locator("#close-lightbox").click();
    await page.goto("/admin.html");
    await page.getByRole("button", { name: "Récentes", exact: true }).click();
    await expect(page.locator(".admin-card")).toHaveCount(6);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`admin-mock-${width}.png`), fullPage: true });
  });
}

for (const [width, height] of [[360, 740], [375, 667], [390, 844], [412, 915], [768, 1024]]) {
  test(`accueil ${width}px: pas de défilement imposé, tampon calibré, bouton visible`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await installMock(page);
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(".polaroid")).toHaveCount(7);
    const m = await page.evaluate(() => {
      const box = (selector) => document.querySelector(selector).getBoundingClientRect();
      const strip = document.querySelector(".polaroid-strip");
      const seal = box(".seal"), portrait = box(".hero-portrait");
      return {
        pageOverflow: document.documentElement.scrollWidth - innerWidth,
        stripOverflow: strip.scrollWidth - strip.clientWidth,
        sealRight: seal.right, sealLeft: seal.left, sealWidth: seal.width, portraitWidth: portrait.width,
        vw: innerWidth,
        offCenter: ["h1", ".hero-intro"].map((selector) => {
          const range = document.createRange();
          range.selectNodeContents(document.querySelector(`.hero ${selector}`));
          const rects = [...range.getClientRects()].filter((r) => r.width > 0);
          const ink = (Math.min(...rects.map((r) => r.left)) + Math.max(...rects.map((r) => r.right))) / 2;
          return Math.abs(ink - innerWidth / 2);
        }),
      };
    });
    expect(m.pageOverflow).toBeLessThanOrEqual(0);
    expect(m.stripOverflow).toBeLessThanOrEqual(0);
    if (width < 700) for (const offset of m.offCenter) expect(offset).toBeLessThanOrEqual(1.5);
    expect(m.sealLeft).toBeGreaterThanOrEqual(0);
    expect(m.sealRight).toBeLessThanOrEqual(m.vw);
    expect(m.sealWidth / m.portraitWidth).toBeGreaterThan(0.2);
    expect(m.sealWidth / m.portraitWidth).toBeLessThan(0.3);
    if (width === 375) {
      const cta = await page.locator(".hero-cta").boundingBox();
      expect(cta.y + cta.height).toBeLessThanOrEqual(height);
      expect(Math.round(cta.height)).toBe(58);
      expect(Math.round(cta.width)).toBe(319);
    }
  });
}

for (const width of [360, 375, 412, 768]) {
  test(`mention de téléchargement près du formulaire d'envoi à ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 800 });
    await installMock(page);
    await page.goto("/#partager");
    const note = page.locator(".share-note");
    await expect(note).toBeVisible();
    await expect(note).toHaveText("Les photos de la galerie publique peuvent être consultées et téléchargées par tous les invités.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    if (width < 700) expect(await note.evaluate((n) => getComputedStyle(n).textAlign)).toBe("center");
    await page.screenshot({ path: info.outputPath(`partager-${width}.png`), fullPage: true });
  });
}
