// Lightbox layout: toolbar on top, photo untouched in the middle, action bar in the thumb zone.
import { test, expect } from "@playwright/test";
import { installMock } from "./mock.js";

async function openFirst(page, photos = 48) {
  await installMock(page, { photos });
  await page.goto("/");
  await expect(page.locator("#gallery .photo-card")).toHaveCount(48);
  await page.locator("#gallery .photo-card").first().click();
  await expect(page.locator("#lightbox")).toBeVisible();
  await expect.poll(() => page.locator("#full-photo").evaluate((i) => i.complete && i.naturalWidth > 0)).toBeTruthy();
}
const rect = (page, selector) =>
  page.locator(selector).evaluate((n) => {
    const r = n.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
  });
const luminance = ([r, g, b]) => {
  const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const parse = (css) => css.match(/[\d.]+/g).map(Number);

test("actions sit in a bottom bar, visible without scrolling, outside the photo, at least 44 px", async ({ page }) => {
  await openFirst(page);
  const vh = page.viewportSize().height;
  const bar = await rect(page, "#lightbox .lightbox-actions");
  const download = await rect(page, "#download");
  const report = await rect(page, "#report-open");
  const photo = await rect(page, "#full-photo");
  const close = await rect(page, "#close-lightbox");
  await expect(page.locator("#download")).toBeInViewport({ ratio: 1 });
  await expect(page.locator("#report-open")).toBeInViewport({ ratio: 1 });
  // Bottom of the screen (thumb zone), safe-area respected by the bar's own padding.
  expect(Math.round(bar.bottom)).toBe(vh);
  expect(bar.y).toBeGreaterThan(vh * 0.7);
  // Left: download; right: report.
  expect(download.x).toBeLessThan(report.x);
  expect(download.x).toBeLessThan(40);
  expect(page.viewportSize().width - report.right).toBeLessThan(40);
  for (const [name, r] of Object.entries({ download, report, close })) {
    expect(r.h, `${name} height`).toBeGreaterThanOrEqual(44);
    expect(r.w, `${name} width`).toBeGreaterThanOrEqual(44);
  }
  await expect(page.locator("#download")).toContainText("Télécharger");
  await expect(page.locator("#download")).toContainText("↓");
  await expect(page.locator("#report-open")).toHaveText("Signaler cette photo");
  // Nothing laid over the photo: it ends above the bar and its centre is the photo itself.
  expect(photo.bottom).toBeLessThanOrEqual(bar.y + 0.5);
  expect(
    await page.evaluate(() => {
      const img = document.getElementById("full-photo");
      const r = img.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === img;
    }),
  ).toBeTruthy();
  // Close: top right, large. Position indicator on top.
  expect(close.y).toBeLessThan(80);
  expect(page.viewportSize().width - close.right).toBeLessThan(40);
  await expect(page.locator("#photo-position")).toHaveText("1 / 48");
  expect((await rect(page, "#photo-position")).y).toBeLessThan(80);
});

test("side arrows are usable (44 px) and never cover the actions or the photo centre", async ({ page }) => {
  await openFirst(page);
  const bar = await rect(page, "#lightbox .lightbox-actions");
  for (const id of ["#previous", "#next"]) {
    const r = await rect(page, id);
    expect(r.h).toBeGreaterThanOrEqual(44);
    expect(r.w).toBeGreaterThanOrEqual(44);
    expect(r.bottom).toBeLessThanOrEqual(bar.y);
  }
  const photo = await rect(page, "#full-photo");
  const next = await rect(page, "#next");
  const previous = await rect(page, "#previous");
  expect(previous.right).toBeLessThanOrEqual(photo.x + 1);
  expect(next.x).toBeGreaterThanOrEqual(photo.right - 1);
});

for (const [label, color] of [["bright", "#ffffff"], ["dark", "#000000"]]) {
  test(`bar stays legible over a ${label} photo (contrast ≥ 4.5:1) and the lightbox stays usable`, async ({ page }, info) => {
    await openFirst(page);
    // Replace the photo by a flat bright / dark image (blob: is allowed by the CSP) and read the real colours.
    await page.evaluate(async (fill) => {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 600;
      const x = canvas.getContext("2d");
      x.fillStyle = fill;
      x.fillRect(0, 0, 800, 600);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      document.getElementById("full-photo").src = URL.createObjectURL(blob);
    }, color);
    await expect.poll(() => page.locator("#full-photo").evaluate((i) => i.complete && i.naturalWidth === 800)).toBeTruthy();
    const style = await page.evaluate(() => {
      const bar = getComputedStyle(document.querySelector("#lightbox .lightbox-actions"));
      const get = (id) => {
        const s = getComputedStyle(document.getElementById(id));
        return { color: s.color, background: s.backgroundColor };
      };
      return { bar: bar.backgroundColor, download: get("download"), report: get("report-open"), close: get("close-lightbox") };
    });
    // The bar is semi-opaque: compose it over the WORST backdrops (white and black) and over the photo colour.
    const [r, g, b, a = 1] = parse(style.bar);
    expect(a).toBeGreaterThan(0.7);
    const over = (back) => [0, 1, 2].map((i) => Math.round([r, g, b][i] * a + back[i] * (1 - a)));
    for (const back of [[255, 255, 255], [0, 0, 0]]) {
      const effective = over(back);
      expect(ratio(parse(style.report.color).slice(0, 3), effective), `report text over ${back}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(parse(style.download.color).slice(0, 3), parse(style.download.background).slice(0, 3)), "download text on its own fill").toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(parse(style.close.color).slice(0, 3), parse(style.close.background).slice(0, 3))).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: info.outputPath(`lightbox-${label}-${page.viewportSize().width}.png`) });
    await page.screenshot({ path: `test-results/lightbox-${label}-${page.viewportSize().width}.png` });
    // Still usable: next/previous and Escape.
    await page.locator("#next").click();
    await expect(page.locator("#photo-position")).toHaveText("2 / 48");
    await page.keyboard.press("Escape");
    await expect(page.locator("#lightbox")).toBeHidden();
  });
}

test("keyboard: focus ring visible on the action buttons, arrows navigate, Escape closes", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard focus ring is checked on desktop and WebKit emulation");
  await openFirst(page);
  const focusRing = async (id) => {
    for (let i = 0; i < 8; i++) {
      if (await page.evaluate((target) => document.activeElement?.id === target, id)) break;
      await page.keyboard.press("Tab");
    }
    return page.evaluate(() => {
      const s = getComputedStyle(document.activeElement);
      return { id: document.activeElement.id, style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
    });
  };
  for (const id of ["download", "report-open"]) {
    const ring = await focusRing(id);
    expect(ring.id).toBe(id);
    expect(ring.style).not.toBe("none");
    expect(ring.width).toBeGreaterThanOrEqual(2);
  }
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#photo-position")).toHaveText("2 / 48");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#photo-position")).toHaveText("1 / 48");
  await page.keyboard.press("Escape");
  await expect(page.locator("#lightbox")).toBeHidden();
});

test("report keeps its confirmation and reasons; download keeps the forced download", async ({ page }) => {
  await openFirst(page);
  await page.locator("#report-open").click();
  await expect(page.locator("#report-dialog")).toBeVisible();
  await expect(page.locator("#report-reason option")).toHaveCount(3);
  await page.locator("#report-cancel").click();
  await expect(page.locator("#report-dialog")).toBeHidden();
  await page.locator("#download").click();
  await expect
    .poll(() => page.evaluate(() => mock.calls.some((c) => c[0] === "sign" && c[3]?.download === "photo-mariage.jpg")))
    .toBeTruthy();
});
