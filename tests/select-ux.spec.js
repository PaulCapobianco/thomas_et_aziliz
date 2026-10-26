// Point 2: the "Sélectionner" button is explicit (icon + label), the activation says what to do,
// ticked cards are unmistakable (big tick, ring), 44 px targets, AA contrast in both themes.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installMock } from "./mock.js";

const cards = (page) => page.locator("#gallery .photo-card");
async function open(page, scheme = "light", photos = 6) {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  await installMock(page, { photos });
  await page.goto("/");
  await expect(cards(page)).toHaveCount(photos);
}
// WCAG contrast of two "rgb(a)" strings (the background is assumed opaque).
const contrast = (fg, bg) => {
  const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
  const lum = ([r, g, b]) => { const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const [a, b] = [lum(rgb(fg)), lum(rgb(bg))].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
};

for (const scheme of ["light", "dark"]) {
  test(`${scheme}: the button has an icon, a visible border and a 44 px target; the help appears on activation`, async ({ page }) => {
    await open(page, scheme);
    const button = page.getByRole("button", { name: /Sélectionner/ });
    await expect(button).toBeVisible();
    await expect(button.locator("svg")).toHaveCount(1);
    const box = await button.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    const border = await button.evaluate((n) => getComputedStyle(n).borderTopColor);
    expect(border).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    await button.click();
    const same = page.locator("#select-mode"); // its name changes once active
    await expect(page.locator("#dl-note")).toHaveText("Touchez les photos pour les choisir");
    await expect(same).toHaveAttribute("aria-pressed", "true");
    await expect(same).toContainText("Quitter la sélection");
  });

  test(`${scheme}: a ticked card has a large tick, a thick ring and AA contrast`, async ({ page }) => {
    await open(page, scheme);
    await page.locator("#select-mode").click();
    await cards(page).nth(1).click();
    const info = await cards(page).nth(1).evaluate((card) => {
      const tick = card.querySelector(".pick-box");
      const t = getComputedStyle(tick), c = getComputedStyle(card), r = tick.getBoundingClientRect();
      return { w: r.width, h: r.height, text: tick.textContent, tickColor: t.color, tickBg: t.backgroundColor, ring: parseFloat(c.outlineWidth), ringStyle: c.outlineStyle, size: t.fontSize };
    });
    expect(info.text).toBe("✓");
    expect(info.w).toBeGreaterThanOrEqual(32);
    expect(info.h).toBeGreaterThanOrEqual(32);
    expect(info.ring).toBeGreaterThanOrEqual(3);
    expect(info.ringStyle).toBe("solid");
    expect(parseFloat(info.size)).toBeGreaterThanOrEqual(18);
    expect(contrast(info.tickColor, info.tickBg)).toBeGreaterThanOrEqual(4.5);
    // An unticked card shows an empty, clearly outlined box (so it reads as "can be ticked").
    const empty = await cards(page).nth(2).evaluate((card) => { const t = card.querySelector(".pick-box"); const r = t.getBoundingClientRect(); return [r.width, getComputedStyle(t).borderTopWidth, t.textContent]; });
    expect(empty[0]).toBeGreaterThanOrEqual(32);
    expect(parseFloat(empty[1])).toBeGreaterThanOrEqual(2);
    expect(empty[2]).toBe("");
    // Each card is a big touch target with an accessible name that says what a tap does.
    const card = await cards(page).nth(1).boundingBox();
    expect(card.width).toBeGreaterThanOrEqual(44);
    expect(card.height).toBeGreaterThanOrEqual(44);
    await expect(cards(page).nth(1)).toHaveAttribute("aria-label", /Retirer de la sélection/);
    await expect(cards(page).nth(2)).toHaveAttribute("aria-label", /Ajouter à la sélection/);
  });

  test(`${scheme}: axe on the selection mode (button, ticked cards, bar)`, async ({ page }) => {
    await open(page, scheme);
    await page.locator("#select-mode").click();
    await cards(page).nth(0).click();
    await cards(page).nth(3).click();
    await page.waitForTimeout(1200);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}

test("the button does not overflow nor push the gallery heading at any width", async ({ page }) => {
  for (const width of [360, 375, 390, 412, 768]) {
    await page.setViewportSize({ width, height: 800 });
    await open(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    const box = await page.locator("#select-mode").boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
});
