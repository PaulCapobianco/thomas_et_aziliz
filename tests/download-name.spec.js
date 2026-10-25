// Lightbox download: imposed file name photo_mariage_Thomas-Aziliz_311026_NN.jpg, per-tab counter, refusals untouched.
import { test, expect } from "@playwright/test";
import { installMock } from "./mock.js";

const NAME = /^photo_mariage_Thomas-Aziliz_311026_(\d{2})\.jpg$/;
const names = (page) =>
  page.evaluate(() => mock.calls.filter((c) => c[0] === "sign" && c[3]?.download).map((c) => c[3].download));

async function openFirst(page) {
  await installMock(page, { photos: 5 });
  await page.route("**/fixtures/photo_01.jpg?download=1", (route) =>
    route.fulfill({ body: "x", contentType: "image/jpeg" }),
  );
  await page.goto("/");
  await expect(page.locator("#gallery .photo-card")).toHaveCount(5);
  await page.locator("#gallery .photo-card").first().click();
  await expect(page.locator("#lightbox")).toBeVisible();
}
const download = async (page, count) => {
  await page.locator("#download").click();
  await expect.poll(async () => (await names(page)).length).toBe(count);
  await expect(page.locator("#download")).toBeEnabled();
};

test("name format, no ampersand, counter increments on each download and survives a reload", async ({ page }) => {
  await openFirst(page);
  await download(page, 1);
  await download(page, 2);
  await page.keyboard.press("ArrowRight");
  await download(page, 3);
  const first = await names(page);
  expect(first).toEqual([
    "photo_mariage_Thomas-Aziliz_311026_01.jpg",
    "photo_mariage_Thomas-Aziliz_311026_02.jpg",
    "photo_mariage_Thomas-Aziliz_311026_03.jpg",
  ]);
  for (const name of first) {
    expect(name).toMatch(NAME);
    expect(name).not.toContain("&");
  }
  await page.reload();
  await expect(page.locator("#gallery .photo-card")).toHaveCount(5);
  await page.locator("#gallery .photo-card").first().click();
  await download(page, 1);
  expect((await names(page))[0]).toBe("photo_mariage_Thomas-Aziliz_311026_04.jpg");
});

test("a fresh browsing session starts again at 01", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await openFirst(page);
  await download(page, 1);
  expect((await names(page))[0]).toMatch(/_01\.jpg$/);
  await context.close();
});

test("name helpers: ampersand, accents, spaces, date and number padding", async ({ page }) => {
  await installMock(page);
  await page.goto("/");
  const out = await page.evaluate(async () => {
    const s = await import("/shared.js");
    return [
      s.downloadName("Thomas & Aziliz", "31 octobre 2026", 1),
      s.downloadName("Élodie  &  Zoé", "5 mars 2027", 12),
      s.downloadName("", "", 100),
      s.compactDate("1 février 2026"),
    ];
  });
  expect(out).toEqual([
    "photo_mariage_Thomas-Aziliz_311026_01.jpg",
    "photo_mariage_Elodie-Zoe_050327_12.jpg",
    "photo_mariage_Thomas-Aziliz_311026_100.jpg",
    "010226",
  ]);
});

test("a refused (non-public) photo is still refused: no download, no number consumed", async ({ page }) => {
  await openFirst(page);
  await page.evaluate(() => { mock.signRefused = true; });
  await page.locator("#download").click();
  await expect(page.locator("#lightbox-status")).toContainText("Téléchargement indisponible");
  await expect(page.locator("#download")).toBeEnabled();
  await page.evaluate(() => { mock.signRefused = false; });
  await download(page, 2);
  const all = await names(page);
  expect(all.at(-1)).toBe("photo_mariage_Thomas-Aziliz_311026_01.jpg");
  // The client only ever asks Storage to sign the path of the photo shown, never a derived one.
  const paths = await page.evaluate(() => mock.calls.filter((c) => c[0] === "sign").map((c) => c[1]));
  expect(new Set(paths).size).toBe(1);
});
