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
    // No destination is preselected, and the choice only appears (in the fixed bar) once photos are selected.
    await expect(page.locator("[name=audience]:checked")).toHaveCount(0);
    await expect(page.locator("#send-bar")).toBeHidden();
    await page.locator("#files").setInputFiles(["fixtures/photo_01.jpg"]);
    await expect(page.locator("#send-bar")).toBeVisible();
    await expect(page.locator("[name=audience]:checked")).toHaveCount(0);
    await page.getByRole("radio", { name: /Uniquement aux mariés/ }).check();
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
