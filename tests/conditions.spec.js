import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installMock } from "./mock.js";

const open = async (page) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  const response = await page.goto("/conditions-utilisation");
  return { response, errors };
};

test("terms page: direct access without authentication, clear title, no errors", async ({ page }) => {
  const { response, errors } = await open(page);
  expect(response.status()).toBe(200);
  await expect(page).toHaveTitle(/Conditions d’utilisation/);
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Conditions d’utilisation");
  expect(errors).toEqual([]);
});

test("terms page: still loads after a refresh and on the .html address", async ({ page }) => {
  await open(page);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Conditions d’utilisation");
  expect((await page.goto("/conditions-utilisation.html")).status()).toBe(200);
});

test("terms page: every required topic has its section and the table of contents works", async ({ page }) => {
  await open(page);
  expect(await page.locator("main h2").allTextContents()).toEqual([
    "À quoi sert ce site ?",
    "Utilisation par les invités",
    "Envoyer des photos",
    "Public ou « mariés uniquement »",
    "Droit à l’image et vie privée",
    "Responsabilités",
    "Modération avant publication",
    "Signalements et demandes de retrait",
    "Accès aux photos",
    "Données personnelles",
    "Contact",
    "Évolution de ces conditions",
  ]);
  for (const href of await page.locator(".legal-toc a").evaluateAll((links) => links.map((link) => link.getAttribute("href"))))
    await expect(page.locator(href)).toHaveCount(1);
});

test("terms page: rules match what the site really does (limits, no edit after sending, moderation, access)", async ({ page }) => {
  await open(page);
  const main = page.locator("main");
  await expect(main).toContainText("30 Mo");
  await expect(main).toContainText("60 mégapixels");
  await expect(main).toContainText("ne permet ni de changer la destination ni de supprimer une photo après son envoi");
  await expect(page.locator("#moderation")).toContainText("attend la validation d’un administrateur");
  await expect(page.locator("#moderation")).toContainText("Une photo en attente n’est jamais visible dans la galerie");
  await expect(page.locator("#retrait")).toContainText("retirée immédiatement de la galerie et examinée par l’administrateur, qui la supprime si nécessaire");
  await expect(page.locator("#acces")).toContainText("ne constituent pas un contrôle d’accès");
  // No promise the site does not keep.
  await expect(main).not.toContainText(/garantissons|sous 24|sous 48|délai de \d|supprimée automatiquement/i);
});

test("terms page: private photos are never described as public", async ({ page }) => {
  await open(page);
  const priv = page.locator(".legal-card", { hasText: "Envoyer uniquement aux mariés" });
  await expect(priv).toContainText("n’apparaît jamais dans la galerie");
  await expect(priv).not.toContainText(/publi/i);
});

test("terms and privacy pages link to each other, and back to the album", async ({ page }) => {
  await open(page);
  await page.locator(".lead").getByRole("link", { name: "politique de confidentialité" }).click();
  await expect(page).toHaveURL(/\/confidentialite$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Confidentialité");
  await page.locator("main").getByRole("link", { name: /conditions d’utilisation/i }).first().click();
  await expect(page).toHaveURL(/\/conditions-utilisation$/);
  await page.getByRole("link", { name: "Revenir à l’album" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("terms page: the configured contact address is a working mailto link; fallback sentence and invalid values handled", async ({ page }) => {
  await open(page);
  const links = page.locator("[data-contact] a");
  await expect(links).toHaveCount(2);
  for (const link of await links.all()) await expect(link).toHaveAttribute("href", "mailto:paul.capobianco13@gmail.com");
  await expect(page.locator("#contact")).toContainText("paul.capobianco13@gmail.com");
  await page.route("**/config.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: `export const PRIVACY_EMAIL="";` }),
  );
  await page.goto("/conditions-utilisation");
  await expect(page.locator("[data-contact] a")).toHaveCount(0);
  await expect(page.locator("#contact [data-contact]")).toContainText("sera indiquée");
  await page.unroute("**/config.js");
  await page.route("**/config.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: `export const PRIVACY_EMAIL='x" onmouseover="alert(1)';` }),
  );
  await page.goto("/conditions-utilisation");
  await expect(page.locator("[data-contact] a")).toHaveCount(0);
});

test("terms page: fits the screen, passes axe, and works with the test mock config", async ({ page }) => {
  await installMock(page);
  await open(page);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("footer of the home page links to both legal pages without widening the page", async ({ page }) => {
  await installMock(page);
  await page.goto("/");
  const footer = page.locator(".site-footer");
  await footer.scrollIntoViewIfNeeded();
  const privacy = footer.getByRole("link", { name: "Confidentialité" });
  const terms = footer.getByRole("link", { name: "Conditions d’utilisation" });
  await expect(privacy).toHaveAttribute("href", "/confidentialite");
  await expect(terms).toHaveAttribute("href", "/conditions-utilisation");
  for (const link of [privacy, terms]) {
    const box = await link.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(24);
    expect(box.width).toBeLessThan(300);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await terms.click();
  await expect(page).toHaveURL(/\/conditions-utilisation$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Conditions d’utilisation");
});

test("terms page: administrator vocabulary, download end date and report wording", async ({ page }) => {
  await open(page);
  const main = page.locator("main");
  await expect(main).toContainText("Paul Capobianco, administrateur unique");
  await expect(page.locator("#acces")).toContainText("téléchargées jusqu’au 20 novembre 2026");
  await expect(page.locator("#acces")).toContainText("accessibles aux mariés et à l’administrateur");
  await expect(page.locator("#retrait")).toContainText("supprime la photo de l’album et de Google Drive dès que possible");
  await expect(page.locator(".legal-updated")).toContainText("25 octobre 2026");
  await expect(main).not.toContainText(/organisateurs|administrateurs/i);
});
