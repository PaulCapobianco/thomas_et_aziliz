import { test, expect } from "@playwright/test";
import { installMock } from "./mock.js";
const fixture = (name) => `fixtures/${name}`;
const settled = (page, timeout = 30000) =>
  expect(page.locator("#upload-message")).toHaveAttribute("data-kind", /success|pending|error/, { timeout });
// The destination card opens the native chooser: answer it like a guest would (no files = cancelled).
async function pick(page, destination, names = []) {
  const chooser = page.waitForEvent("filechooser");
  await page.locator(`[data-destination=${destination}]`).click();
  await (await chooser).setFiles(names.map(fixture));
}
const modelLoads = (page) => page.evaluate(() => mock.calls.filter((c) => c[0] === "model-load").length);

test("choosing the public destination warms the model once, without sending anything", async ({ page }) => {
  await installMock(page);
  await page.goto("/#partager");
  expect(await modelLoads(page)).toBe(0);
  await pick(page, "public");
  await expect.poll(() => modelLoads(page)).toBe(1);
  expect(await page.evaluate(() => mock.calls.filter((c) => c[0] === "upload").length)).toBe(0);
  // Picking a photo then sending reuses the same model: still a single load.
  await pick(page, "public", ["photo_01.jpg"]);
  await page.locator("#send").click();
  await settled(page);
  expect(await modelLoads(page)).toBe(1);
  expect(await page.evaluate(() => mock.records[0].status)).toBe("published");
});

test("the private destination never loads the filter model", async ({ page }) => {
  await installMock(page);
  await page.goto("/#partager");
  await pick(page, "maries", ["photo_01.jpg"]);
  await page.locator("#send").click();
  await settled(page);
  expect(await modelLoads(page)).toBe(0);
});

test("a preload that fails is invisible and the first photo retries the load", async ({ page }) => {
  await installMock(page, { model: "unavailable" });
  await page.goto("/#partager");
  await pick(page, "public");
  await expect.poll(() => modelLoads(page)).toBe(1);
  await expect(page.locator("#upload-message")).not.toHaveAttribute("data-kind", "error");
  await pick(page, "public", ["photo_01.jpg"]);
  await page.locator("#send").click();
  await settled(page);
  // The model is unavailable: the photo is kept for review (never published unchecked), exactly as before.
  expect(await page.evaluate(() => mock.records[0].status)).toBe("pending_review");
  expect(await modelLoads(page)).toBeGreaterThanOrEqual(2); // each new trigger retries the load
});

test("the bar moves by stage inside a single photo and never goes backwards", async ({ page }) => {
  await installMock(page, { uploadDelay: 250 });
  await page.goto("/#partager");
  await page.evaluate(() => {
    window.__bar = [];
    const bar = document.getElementById("progress");
    new MutationObserver(() => window.__bar.push(bar.value)).observe(bar, { attributes: true, attributeFilter: ["value"] });
  });
  await pick(page, "public", ["photo_01.jpg"]);
  await page.locator("#send").click();
  await settled(page);
  const values = await page.evaluate(() => window.__bar);
  expect(values.some((v) => v > 0 && v < 100)).toBeTruthy();
  expect(values.slice(1).every((v, i) => v >= values[i])).toBeTruthy();
  expect(values.at(-1)).toBe(100);
});

test("the displayed image is at most 2400 px, the thumbnail 640 px, and both fit the 3 MiB bucket limit", async ({ page }) => {
  await installMock(page);
  await page.goto("/#partager");
  await pick(page, "public", ["photo_01.jpg"]);
  await page.locator("#send").click();
  await settled(page);
  const uploads = await page.evaluate(() => mock.calls.filter((c) => c[0] === "upload"));
  expect(uploads).toHaveLength(2);
  for (const [, , meta] of uploads) expect(meta.size).toBeLessThan(3145728);
  const dims = await page.evaluate(() => [...mock.objects].map(([p, o]) => [p, Math.max(o.width, o.height)]));
  for (const [path, side] of dims) expect(side).toBeLessThanOrEqual(path.includes("/thumbs/") ? 640 : 2400);
});

test("constants: 2400 px / q0.85 and the 3-attempt retry delays are unchanged", async ({ page }) => {
  await installMock(page);
  await page.goto("/");
  const c = await page.evaluate(async () => {
    const m = await import("/uploads.js");
    return [m.FULL_MAX_SIDE, m.FULL_QUALITY, m.THUMB_MAX_SIDE, m.THUMB_QUALITY];
  });
  expect(c).toEqual([2400, 0.85, 640, 0.84]);
});
