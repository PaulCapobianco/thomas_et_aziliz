import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installMock } from "./mock.js";

const open = async (page) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  const response = await page.goto("/confidentialite");
  return { response, errors };
};

test("privacy page: direct access without authentication, clear title, no errors", async ({ page }) => {
  const { response, errors } = await open(page);
  expect(response.status()).toBe(200);
  await expect(page).toHaveTitle(/Confidentialité/);
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Confidentialité");
  expect(errors).toEqual([]);
});

test("privacy page: still loads after a refresh and on the .html address", async ({ page }) => {
  await open(page);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Confidentialité");
  expect((await page.goto("/confidentialite.html")).status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Confidentialité");
});

test("privacy page: required sections are present", async ({ page }) => {
  await open(page);
  const headings = await page.locator("main h2").allTextContents();
  expect(headings).toEqual([
    "Qui gère ce site ?",
    "Les données traitées",
    "Pourquoi ces données ?",
    "Photos publiques et photos « mariés uniquement »",
    "Hébergement et stockage",
    "Conservation",
    "Signaler ou faire retirer une photo",
    "Sécurité",
    "Google Drive",
    "Vos droits",
  ]);
  for (const href of await page.locator(".legal-toc a").evaluateAll((links) => links.map((link) => link.getAttribute("href"))))
    await expect(page.locator(href)).toHaveCount(1);
});

test("privacy page: Google Drive is described as NOT active yet, with the drive.file scope and no guest sign-in", async ({ page }) => {
  await open(page);
  const drive = page.locator("#google-drive");
  await expect(drive.locator("[data-drive-status]")).toHaveAttribute("data-drive-status", "inactive");
  await expect(drive).toContainText("n’est pas encore activée");
  await expect(drive).toContainText("drive.file");
  await expect(drive).toContainText("Les invités n’ont pas besoin de connecter de compte Google");
  // Nothing must claim the backup is already running.
  await expect(page.locator("main")).not.toContainText(/est activée|est désormais activée|déjà activée/);
});

test("privacy page: private photos are never described as public", async ({ page }) => {
  await open(page);
  const priv = page.locator(".legal-card", { hasText: "Envoyer uniquement aux mariés" });
  await expect(priv).toContainText("n’apparaît jamais dans la galerie");
  await expect(priv).not.toContainText(/publi/i);
});

test("privacy page: the configured contact address is shown as a working mailto link everywhere it is needed", async ({ page }) => {
  await open(page);
  const links = page.locator("[data-contact] a");
  await expect(links).toHaveCount(3);
  for (const link of await links.all()) {
    await expect(link).toHaveAttribute("href", "mailto:paul.capobianco13@gmail.com");
    await expect(link).toHaveText("paul.capobianco13@gmail.com");
  }
  // Public page and public address only: no other mail address on the page.
  const text = await page.locator("main").innerText();
  expect([...new Set(text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g))]).toEqual(["paul.capobianco13@gmail.com"]);
});

test("privacy page: without an address the page keeps a visible fallback sentence; invalid values are ignored", async ({ page }) => {
  await page.route("**/config.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: `export const PRIVACY_EMAIL="";` }),
  );
  await open(page);
  await expect(page.locator("[data-contact] a")).toHaveCount(0);
  await expect(page.locator("[data-contact]").first()).toContainText("sera indiquée");
  await page.unroute("**/config.js");
  await page.route("**/config.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: `export const PRIVACY_EMAIL='x" onmouseover="alert(1)';` }),
  );
  await page.goto("/confidentialite");
  await expect(page.locator("[data-contact] a")).toHaveCount(0);
});

test("privacy page: works with the test mock config (no PRIVACY_EMAIL export)", async ({ page }) => {
  await installMock(page);
  const { errors } = await open(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Confidentialité");
  expect(errors).toEqual([]);
});

test("privacy page: layout fits the screen and passes axe", async ({ page }) => {
  await open(page);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("footer link on the home page leads to the privacy page, and back to the album", async ({ page }) => {
  await installMock(page);
  await page.goto("/");
  const link = page.locator(".site-footer").getByRole("link", { name: "Confidentialité" });
  await link.scrollIntoViewIfNeeded();
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "/confidentialite");
  const box = await link.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(24);
  expect(box.width).toBeLessThan(300); // only the text is clickable, not the whole footer row
  await link.click();
  await expect(page).toHaveURL(/\/confidentialite$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Confidentialité");
  await page.getByRole("link", { name: "Revenir à l’album" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Les photos de notre mariage");
  // The header links of the privacy page reach the album routes.
  await page.goto("/confidentialite");
  await page.getByRole("link", { name: "Partager des photos", exact: true }).click();
  await expect(page).toHaveURL(/\/#partager$/);
  await expect(page.locator("#share-view")).toBeVisible();
});

test("footer link does not disturb the footer or the page width on the home page", async ({ page }) => {
  await installMock(page);
  await page.goto("/");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await expect(page.locator(".site-footer")).toContainText("Les instants passent. Les souvenirs restent.");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
