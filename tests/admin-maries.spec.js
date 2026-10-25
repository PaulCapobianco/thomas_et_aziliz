// Onglet « Mariés uniquement » de l'admin : sélection multiple et actions groupées (mêmes composants que les autres onglets).
import { test, expect } from "@playwright/test";
import { installMock } from "./mock.js";

const cards = (page) => page.locator(".admin-card");
const tick = (page, index) => cards(page).nth(index).locator(".select-box input").check();
async function openMaries(page, options = {}) {
  await installMock(page, { admin: true, maries: 4, photos: 2, ...options });
  await page.goto("/admin.html");
  await expect(page.locator("#dashboard")).toBeVisible();
  await page.getByRole("button", { name: /^Mariés uniquement/ }).click();
  await expect(page.locator("[data-filter=maries]")).toHaveAttribute("aria-pressed", "true");
  await expect(cards(page)).toHaveCount(4);
}

test("maries tab: every card has a checkbox, 'Tout sélectionner' works, the bar shows the right actions", async ({ page }) => {
  await openMaries(page);
  await expect(page.locator(".admin-card .select-box input")).toHaveCount(4);
  await expect(page.locator("#batch-bar")).toBeHidden();
  await tick(page, 0);
  await tick(page, 1);
  await expect(page.locator("#batch-summary")).toHaveText("2 photos sélectionnées");
  await expect(page.locator("#batch-remove")).toHaveText("Masquer (2)");
  await expect(page.locator("#batch-restore")).toHaveText("Restaurer (2)");
  await expect(page.locator("#batch-delete")).toHaveText("Supprimer (2)");
  await expect(page.locator("#batch-approve")).toBeHidden();
  await expect(page.locator("#batch-reject")).toBeHidden();
  await expect(page.locator("#batch-keep")).toBeHidden();
  await page.locator("#select-all").click();
  await expect(page.locator("#batch-summary")).toHaveText("4 photos sélectionnées");
  await page.locator("#select-all").click();
  await expect(page.locator("#batch-bar")).toBeHidden();
});

test("maries tab: batch Masquer then Restaurer change the status of the selection only", async ({ page }) => {
  await openMaries(page);
  await tick(page, 0);
  await tick(page, 1);
  await page.locator("#batch-remove").click();
  await expect(page.locator("#admin-message")).toContainText("2 photos masquées", { timeout: 10000 });
  expect(await page.evaluate(() => mock.records.filter((r) => r.audience === "maries" && r.status === "hidden").length)).toBe(2);
  expect(await page.evaluate(() => mock.records.filter((r) => r.audience === "maries" && r.status === "published").length)).toBe(2);
  expect(await page.evaluate(() => mock.records.filter((r) => r.audience === "public" && r.status === "published").length)).toBe(2);
  await tick(page, 0);
  await page.locator("#batch-restore").click();
  await expect(page.locator("#confirm-message")).toContainText("Rendre à nouveau visibles 1 photo dans l’espace des mariés ?");
  await page.locator("#confirm-no").click();
  await page.locator("#batch-restore").click();
  await page.locator("#confirm-yes").click();
  await expect(page.locator("#admin-message")).toContainText("1 photo restaurée", { timeout: 10000 });
});

test("maries tab: batch Supprimer asks first and nothing is deleted when cancelled", async ({ page }) => {
  await openMaries(page);
  await page.locator("#select-all").click();
  await page.locator("#batch-delete").click();
  await expect(page.locator("#confirm-message")).toContainText("Supprimer définitivement 4 photos ?");
  await page.locator("#confirm-no").click();
  expect(await page.evaluate(() => mock.records.filter((r) => r.status === "deleted").length)).toBe(0);
  await expect(cards(page)).toHaveCount(4);
});

test("selection is cleared when changing tab, and the other tabs keep their own actions", async ({ page }) => {
  await openMaries(page);
  await tick(page, 0);
  await page.getByRole("button", { name: "Récentes" }).click();
  await expect(page.locator("#batch-bar")).toBeHidden();
  await tick(page, 0);
  await expect(page.locator("#batch-remove")).toHaveText("Retirer (1)");
  await expect(page.locator("#batch-restore")).toBeHidden();
});
