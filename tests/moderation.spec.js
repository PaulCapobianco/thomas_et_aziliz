// Validation before publication: renamed switch, guest wording, pending queue with batch actions, recent photos.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installMock } from "./mock.js";

const cards = (page) => page.locator(".admin-card");
const ids = (page) => page.locator(".admin-card input[data-id]").evaluateAll((nodes) => nodes.map((n) => n.dataset.id.slice(0, 8)));
const bar = (page) => page.locator("#batch-bar");
const tick = (page, index) => cards(page).nth(index).locator(".select-box input").check();
const statusOf = (page, prefix) => page.evaluate((p) => mock.records.find((r) => r.id.startsWith(p)).status, prefix);
async function openAdmin(page, options = {}) {
  await installMock(page, { admin: true, ...options });
  await page.goto("/admin.html");
  await expect(page.locator("#dashboard")).toBeVisible();
}
async function openQueue(page, options = {}) {
  await openAdmin(page, options);
  await page.getByRole("button", { name: /^En attente/ }).click();
  await expect(page.locator("[data-filter=pending]")).toHaveAttribute("aria-pressed", "true");
}

test("the pause is now the 'validation avant publication' switch (labels, state, confirmations)", async ({ page }) => {
  await openAdmin(page, { photos: 1 });
  await expect(page.locator("#pause")).toHaveText("Activer la validation avant publication");
  await expect(page.locator("#publication-state")).toHaveText("Galerie publique en ligne");
  await page.locator("#pause").click();
  await expect(page.locator("#pause")).toHaveText("Désactiver la validation avant publication");
  await expect(page.locator("#publication-state")).toContainText("Validation avant publication activée");
  await expect(page.locator("#publication-state")).toContainText("chaque nouvelle photo attend votre validation");
  await page.getByRole("button", { name: /^En attente/ }).click();
  // Releasing a whole group is refused while the validation mode is on, in the new words.
  await page.locator("[data-release=paused]").click();
  await expect(page.locator("#admin-message")).toContainText("Désactivez la validation avant publication");
  await page.locator("#pause").click();
  await expect(page.locator("#pause")).toHaveText("Activer la validation avant publication");
  await page.locator("[data-release=paused]").click();
  await expect(page.locator("#confirm-message")).toContainText("Publier toutes les photos en attente de validation ?");
  await page.locator("#confirm-no").click();
  await expect(page.locator("body")).not.toContainText("Publications suspendues");
  await expect(page.locator("body")).not.toContainText("Suspendre les nouvelles publications");
  await expect(page.locator(".notice")).toContainText("validation avant publication");
});

test("queue: counter on the tab, nsfw first then newest", async ({ page }) => {
  await openAdmin(page, { pending: ["paused", "nsfw", "paused", "nsfw"] });
  await expect(page.locator("[data-filter=pending]")).toHaveText("En attente (4)");
  await page.locator("[data-filter=pending]").click();
  await expect(cards(page)).toHaveCount(4);
  // ids: 1 (oldest, paused), 2 (nsfw), 3 (paused), 4 (newest, nsfw)  =>  4, 2, 3, 1
  expect(await ids(page)).toEqual(["ffff0004", "ffff0002", "ffff0003", "ffff0001"]);
  await expect(cards(page).nth(0)).toContainText("Contenu à vérifier");
  await expect(cards(page).nth(1)).toContainText("Contenu à vérifier");
  await expect(cards(page).nth(2)).toContainText("En attente de validation");
});

test("selection: checkboxes, bottom bar with counts, thumb-sized buttons, nothing hidden behind it", async ({ page }) => {
  await openQueue(page, { pending: Array(8).fill("paused") });
  await expect(cards(page)).toHaveCount(8);
  await expect(bar(page)).toBeHidden();
  await tick(page, 0);
  await tick(page, 1);
  await expect(bar(page)).toBeVisible();
  await expect(page.locator("#batch-summary")).toHaveText("2 photos sélectionnées");
  await expect(page.locator("#batch-approve")).toHaveText("Valider (2)");
  await expect(page.locator("#batch-reject")).toHaveText("Refuser (2)");
  await expect(page.locator("#batch-remove")).toBeHidden();
  const vh = page.viewportSize().height;
  const rect = (selector) => page.locator(selector).evaluate((n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom }; });
  const barBox = await rect("#batch-bar");
  expect(Math.round(barBox.bottom)).toBe(vh); // fixed at the bottom, in the thumb zone
  for (const id of ["#batch-approve", "#batch-reject"]) {
    const b = await rect(id);
    expect(b.h).toBeGreaterThanOrEqual(52);
    expect(b.w).toBeGreaterThanOrEqual(120);
    await expect(page.locator(id)).toBeInViewport({ ratio: 1 });
  }
  // The checkboxes are 44 px+ targets.
  const box = await cards(page).first().locator(".select-box").evaluate((n) => { const r = n.getBoundingClientRect(); return [r.width, r.height]; });
  expect(Math.min(...box)).toBeGreaterThanOrEqual(44);
  // The last card can be scrolled above the bar.
  await cards(page).last().scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect
    .poll(() => cards(page).last().evaluate((n) => n.getBoundingClientRect().bottom), { timeout: 5000 })
    .toBeLessThanOrEqual(barBox.y + 1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  // Select all / none.
  await page.locator("#select-all").click();
  await expect(page.locator("#batch-approve")).toHaveText("Valider (8)");
  await page.locator("#select-all").click();
  await expect(bar(page)).toBeHidden();
});

test("batch 'Valider': flagged photos ask for a check, progress is visible, report is clear", async ({ page }) => {
  await openQueue(page, { pending: ["nsfw", "paused", "paused"] });
  await page.evaluate(() => (mock.statusDelay = 400));
  await page.locator("#select-all").click();
  await page.locator("#batch-approve").click();
  await expect(page.locator("#confirm-message")).toContainText("1 photo signalée par le filtre automatique est dans la sélection");
  await page.locator("#confirm-no").click();
  expect(await page.evaluate(() => mock.calls.filter((c) => c[0] === "admin_set_status").length)).toBe(0);
  await page.locator("#batch-approve").click();
  await page.locator("#confirm-yes").click();
  await expect(page.locator("#batch-progress")).toBeVisible();
  await expect(page.locator("#batch-summary")).toContainText(/Traitement : \d sur 3…/);
  await expect(page.locator("#admin-message")).toContainText("3 photos validées : visible dans la galerie.", { timeout: 15000 });
  const calls = await page.evaluate(() => mock.calls.filter((c) => c[0] === "admin_set_status"));
  expect(calls).toHaveLength(3); // one request per photo
  expect(calls.every((c) => c[1].p_status === "published")).toBeTruthy();
  await expect(cards(page)).toHaveCount(0);
  await expect(bar(page)).toBeHidden();
  await expect(page.locator("[data-filter=pending]")).toHaveText("En attente (0)");
});

test("batch 'Refuser': confirmation first; refused photos are hidden, not deleted", async ({ page }) => {
  await openQueue(page, { pending: ["paused", "paused", "paused"] });
  await tick(page, 0);
  await tick(page, 1);
  await page.locator("#batch-reject").click();
  await expect(page.locator("#confirm-message")).toContainText("Refuser 2 photos ?");
  await page.locator("#confirm-no").click();
  expect(await page.evaluate(() => mock.records.filter((r) => r.status === "pending_review").length)).toBe(3);
  await page.locator("#batch-reject").click();
  await page.locator("#confirm-yes").click();
  await expect(page.locator("#admin-message")).toContainText("2 photos refusées.", { timeout: 10000 });
  expect(await page.evaluate(() => mock.records.filter((r) => r.status === "hidden").length)).toBe(2);
  expect(await page.evaluate(() => mock.records.some((r) => r.status === "deleted"))).toBeFalsy();
  await expect(cards(page)).toHaveCount(1);
});

test("a single pending card asks before refusing", async ({ page }) => {
  await openQueue(page, { pending: ["paused"] });
  await expect(cards(page).first().getByRole("button", { name: "Refuser", exact: true })).toBeVisible();
  await expect(cards(page).first().getByRole("button", { name: "Valider", exact: true })).toBeVisible();
  await cards(page).first().getByRole("button", { name: "Refuser", exact: true }).click();
  await expect(page.locator("#confirm-message")).toContainText("Refuser cette photo ?");
  await page.locator("#confirm-no").click();
  await expect(cards(page)).toHaveCount(1);
  await cards(page).first().getByRole("button", { name: "Refuser", exact: true }).click();
  await page.locator("#confirm-yes").click();
  await expect(cards(page)).toHaveCount(0);
});

test("batch failures are reported, failed photos stay selected and can be retried", async ({ page }) => {
  await openQueue(page, { pending: ["paused", "paused", "paused"] });
  const failing = await page.evaluate(() => {
    const id = mock.records.find((r) => r.id.startsWith("ffff0002")).id;
    mock.failStatusFor.add(id);
    return id;
  });
  await page.locator("#select-all").click();
  await page.locator("#batch-approve").click();
  await expect(page.locator("#admin-message")).toContainText("2 photos validées", { timeout: 10000 });
  await expect(page.locator("#admin-message")).toContainText("1 échec :");
  await expect(page.locator("#admin-message")).toContainText("Cette photo reste sélectionnée : réessayez.");
  await expect(cards(page)).toHaveCount(1);
  await expect(page.locator("#batch-approve")).toHaveText("Valider (1)");
  await expect(cards(page).first().locator("input[data-id]")).toBeChecked();
  await page.evaluate((id) => mock.failStatusFor.delete(id), failing);
  await page.locator("#batch-approve").click();
  await expect(page.locator("#admin-message")).toContainText("1 photo validée", { timeout: 10000 });
  await expect(cards(page)).toHaveCount(0);
});

test("30 s auto refresh: new photos appear, counter updates, ticks are kept, no redraw when nothing changed", async ({ page }) => {
  await page.clock.install();
  await openQueue(page, { pending: ["paused", "paused", "paused"] });
  await tick(page, 0);
  await tick(page, 1);
  await page.evaluate(() => (document.querySelector(".admin-card").dataset.mark = "same-node"));
  await page.clock.fastForward(30500);
  await page.waitForTimeout(300);
  // Nothing changed on the server: same DOM nodes, same ticks.
  expect(await page.evaluate(() => document.querySelector(".admin-card")?.dataset.mark)).toBe("same-node");
  await expect(page.locator("#batch-approve")).toHaveText("Valider (2)");
  // A new flagged photo arrives: it shows up first, the count grows, previous ticks stay.
  const before = await ids(page);
  await page.evaluate(() => mock.addPending("nsfw"));
  await page.clock.fastForward(30500);
  await expect(cards(page)).toHaveCount(4);
  await expect(page.locator("[data-filter=pending]")).toHaveText("En attente (4)");
  expect((await ids(page))[0]).toBe("ffff0004");
  await expect(page.locator("#batch-approve")).toHaveText("Valider (2)");
  for (const prefix of before.slice(0, 2)) await expect(page.locator(`input[data-id^="${prefix}"]`)).toBeChecked();
});

test("'Récentes': a Retirer button on every card, multiple selection and the same bar", async ({ page }) => {
  await openAdmin(page, { photos: 4 });
  await page.getByRole("button", { name: "Récentes", exact: true }).click();
  await expect(cards(page)).toHaveCount(4);
  for (let i = 0; i < 4; i++) await expect(cards(page).nth(i).getByRole("button", { name: "Retirer", exact: true })).toBeVisible();
  await expect(page.locator("#batch-bar")).toBeHidden();
  await tick(page, 0);
  await tick(page, 2);
  await expect(page.locator("#batch-remove")).toBeVisible();
  await expect(page.locator("#batch-remove")).toHaveText("Retirer (2)");
  await expect(page.locator("#batch-approve")).toBeHidden();
  await expect(page.locator("#batch-reject")).toBeHidden();
  await expect(page.locator("#batch-remove")).toBeInViewport({ ratio: 1 });
  await page.locator("#batch-remove").click(); // reversible: no confirmation, straight to the report
  await expect(page.locator("#admin-message")).toContainText("2 photos retirées.", { timeout: 10000 });
  expect(await page.evaluate(() => mock.records.filter((r) => r.status === "hidden").length)).toBe(2);
  // One-tap removal on a single card.
  await cards(page).nth(1).getByRole("button", { name: "Retirer", exact: true }).click();
  await expect.poll(() => page.evaluate(() => mock.records.filter((r) => r.status === "hidden").length)).toBe(3);
  // Other tabs keep the old wording and have no selection.
  await page.getByRole("button", { name: "Signalées", exact: true }).click();
  await expect(page.locator(".select-box")).toHaveCount(0);
});
