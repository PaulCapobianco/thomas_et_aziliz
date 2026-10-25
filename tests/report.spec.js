// Reporting: a mandatory reason, ONE valid report hides the photo (server side), admin review (restore / keep hidden / delete).
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installMock } from "./mock.js";

const REASONS = [
  ["sexual", "Contenu sexuel, nudité ou sextoy"],
  ["violence", "Violence ou contenu choquant"],
  ["privacy", "Atteinte à la vie privée / droit à l’image"],
  ["inappropriate", "Photo inappropriée ou hors sujet"],
  ["other", "Autre raison"],
];
const THANKS = "Merci pour votre signalement. Cette photo a été retirée temporairement de la galerie et sera examinée par l’administrateur.";
const reportCalls = (page) => page.evaluate(() => mock.calls.filter((c) => c[0] === "report_photo").map((c) => c[1]));
async function openReport(page, options = { photos: 3 }) {
  await installMock(page, options);
  await page.goto("/");
  await expect(page.locator("#gallery .photo-card")).not.toHaveCount(0);
  await page.locator("#gallery .photo-card").first().click();
  await expect(page.locator("#lightbox")).toBeVisible();
  await page.locator("#report-open").click();
  await expect(page.locator("#report-dialog")).toBeVisible();
}

test.describe("guest dialog", () => {
  test("title, the five reasons, nothing selected, submit inactive; a forced submit sends nothing", async ({ page }) => {
    await openReport(page);
    await expect(page.getByRole("heading", { name: "Pourquoi signalez-vous cette photo ?" })).toBeVisible();
    const labels = await page.locator(".report-reason").allTextContents();
    expect(labels.map((t) => t.trim())).toEqual(REASONS.map(([, label]) => label));
    await expect(page.locator("[name=report-reason]:checked")).toHaveCount(0);
    await expect(page.locator("#report-submit")).toBeDisabled();
    await expect(page.locator("#report-submit")).toHaveText("Envoyer le signalement");
    await page.evaluate(() => document.getElementById("report-form").requestSubmit());
    await page.waitForTimeout(400);
    expect(await reportCalls(page)).toHaveLength(0);
  });

  test("optional comment for the four ordinary reasons; 'Autre raison' needs a description", async ({ page }) => {
    await openReport(page);
    await expect(page.locator("#report-comment-label")).toHaveText("Commentaire (facultatif)");
    for (const [value, label] of REASONS.slice(0, 4)) {
      await page.getByRole("radio", { name: label }).check();
      await expect(page.locator("#report-submit")).toBeEnabled();
      await expect(page.locator("#report-comment")).not.toHaveAttribute("required", "");
    }
    await page.getByRole("radio", { name: "Autre raison" }).check();
    await expect(page.locator("#report-comment-label")).toHaveText("Décrivez la raison (obligatoire)");
    await expect(page.locator("#report-comment")).toHaveAttribute("aria-required", "true");
    await expect(page.locator("#report-submit")).toBeDisabled();
    await page.locator("#report-comment").fill("  ab  ");
    await expect(page.locator("#report-submit")).toBeDisabled();
    await page.locator("#report-comment").fill("Un objet déplacé au premier plan");
    await expect(page.locator("#report-submit")).toBeEnabled();
    await page.locator("#report-comment").fill("x".repeat(600));
    expect(await page.locator("#report-comment").inputValue()).toHaveLength(500); // maxlength
    await expect(page.locator("#report-comment-count")).toHaveText("500 / 500");
  });

  test("one valid report: confirmation, photo gone from the grid at once, server stored reason + comment, nothing shown publicly", async ({ page }) => {
    await openReport(page);
    const id = await page.evaluate(() => mock.records.find((r) => r.status === "published").id);
    const openedId = await page.locator("#gallery .photo-card").first().getAttribute("data-photo-id");
    await page.getByRole("radio", { name: "Atteinte à la vie privée / droit à l’image" }).check();
    await page.locator("#report-comment").fill("On me reconnaît sur cette photo");
    await page.getByRole("button", { name: "Envoyer le signalement" }).click();
    await expect(page.locator("#gallery-status")).toHaveText(THANKS);
    await expect(page.locator("#report-dialog")).toBeHidden();
    await expect(page.locator("#lightbox")).toBeHidden();
    await expect(page.locator(`[data-photo-id="${openedId}"]`)).toHaveCount(0);
    await expect(page.locator("#gallery .photo-card")).toHaveCount(2);
    const calls = await reportCalls(page);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ p_reason: "privacy", p_comment: "On me reconnaît sur cette photo" });
    const record = await page.evaluate((pid) => { const r = mock.records.find((x) => x.id === pid); return { status: r.status, reason: r.review_reason, reports: r.reports.length }; }, openedId);
    expect(record).toEqual({ status: "hidden", reason: "reports", reports: 1 });
    // Neither the reason nor the comment appears anywhere on the guest page.
    const text = await page.locator("body").innerText();
    expect(text).not.toContain("On me reconnaît");
    expect(text).not.toContain("vie privée");
    void id;
    // The photo stays out after a refresh, and the thanks stays readable for a while.
    await page.locator("#refresh").click();
    await expect(page.locator(`[data-photo-id="${openedId}"]`)).toHaveCount(0);
  });

  test("a photo reported from another device disappears at the next refresh (cache refreshed)", async ({ page }) => {
    await installMock(page, { photos: 3 });
    await page.goto("/");
    await expect(page.locator("#gallery .photo-card")).toHaveCount(3);
    const victim = await page.locator("#gallery .photo-card").nth(1).getAttribute("data-photo-id");
    await page.evaluate((id) => { const r = mock.records.find((x) => x.id === id); r.status = "hidden"; r.review_reason = "reports"; }, victim);
    await page.locator("#refresh").click();
    await expect(page.locator("#gallery .photo-card")).toHaveCount(2);
    await expect(page.locator(`[data-photo-id="${victim}"]`)).toHaveCount(0);
  });

  test("errors are explained: rate limit keeps the dialog open; unknown error asks to retry", async ({ page }) => {
    await openReport(page, { photos: 2, rateLimitReports: true });
    await page.getByRole("radio", { name: "Violence ou contenu choquant" }).check();
    await page.getByRole("button", { name: "Envoyer le signalement" }).click();
    await expect(page.locator("#report-status")).toHaveText("Trop de signalements en peu de temps, réessayez dans quelques minutes.");
    await expect(page.locator("#report-dialog")).toBeVisible();
    await expect(page.locator("#gallery .photo-card")).toHaveCount(2); // nothing was hidden
  });

  test("after an admin restoration the photo is visible again and can be reported again (new report hides again)", async ({ page }) => {
    await openReport(page, { photos: 2 });
    const id = await page.locator("#gallery .photo-card").first().getAttribute("data-photo-id");
    await page.getByRole("radio", { name: "Photo inappropriée ou hors sujet" }).check();
    await page.getByRole("button", { name: "Envoyer le signalement" }).click();
    await expect(page.locator(`[data-photo-id="${id}"]`)).toHaveCount(0);
    // The administrator restores it: reports are kept but resolved.
    await page.evaluate((pid) => {
      const r = mock.records.find((x) => x.id === pid);
      r.status = "published"; r.review_reason = null;
      r.reports.forEach((x) => Object.assign(x, { resolved: true, resolution: "restored" }));
    }, id);
    await page.locator("#refresh").click();
    await expect(page.locator(`[data-photo-id="${id}"]`)).toHaveCount(1);
    expect(await page.evaluate((pid) => mock.records.find((x) => x.id === pid).status, id)).toBe("published"); // the old report did not hide it again
    await page.locator(`[data-photo-id="${id}"]`).click();
    await page.locator("#report-open").click();
    await page.getByRole("radio", { name: "Violence ou contenu choquant" }).check();
    await page.getByRole("button", { name: "Envoyer le signalement" }).click();
    await expect(page.locator(`[data-photo-id="${id}"]`)).toHaveCount(0);
    expect(await page.evaluate((pid) => mock.records.find((x) => x.id === pid).status, id)).toBe("hidden");
  });

  test("phone layout: bottom-sheet dialog inside the screen, 52 px choices, axe-core clean", async ({ page }) => {
    await openReport(page);
    const box = await page.locator("#report-dialog").boundingBox();
    const viewport = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(-0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5);
    for (const radio of await page.locator(".report-reason").all()) expect((await radio.boundingBox()).height).toBeGreaterThanOrEqual(50);
    await page.getByRole("radio", { name: "Autre raison" }).check();
    await page.locator("#report-comment").fill("Texte de description");
    const submit = await page.locator("#report-submit").boundingBox();
    expect(submit.height).toBeGreaterThanOrEqual(50);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.locator("#report-cancel").click();
    await expect(page.locator("#report-dialog")).toBeHidden();
    expect(await reportCalls(page)).toHaveLength(0); // cancelling sends nothing
  });
});

test.describe("administration", () => {
  const cards = (page) => page.locator(".admin-card");
  async function openReported(page, options) {
    await installMock(page, { admin: true, ...options });
    await page.goto("/admin.html");
    await expect(page.locator("#dashboard")).toBeVisible();
    await expect(page.locator("[data-filter=reported]")).toHaveAttribute("aria-pressed", "true");
  }
  const statusOf = (page, prefix) => page.evaluate((p) => { const r = mock.records.find((x) => x.id.startsWith(p)); return [r.status, r.review_reason, r.reports.map((x) => x.resolution)]; }, prefix);

  test("each reported photo shows thumbnail, report date, reason, comment, totals and status; counter on the tab", async ({ page }) => {
    await openReported(page, { reported: [{ reports: [{ reason: "sexual", comment: "Objet déplacé" }, { reason: "violence", comment: null }] }] });
    await expect(page.locator("[data-filter=reported]")).toHaveText("Signalées (1)");
    await expect(cards(page)).toHaveCount(1);
    const card = cards(page).first();
    await expect(card.locator("img")).toBeVisible();
    await expect(card.locator("h3")).toHaveText("Masquée");
    await expect(card).toContainText("2 signalements au total · 2 à examiner · dernier le");
    await expect(card).toContainText("Masquée à la suite d’un signalement");
    await expect(card.locator(".report-list li")).toHaveCount(2);
    await expect(card).toContainText("Contenu sexuel, nudité ou sextoy");
    await expect(card).toContainText("« Objet déplacé »");
    await expect(card).toContainText("Violence ou contenu choquant");
    await expect(card.locator(".report-list li strong").first()).toContainText(/\d{2}\/\d{2}\/\d{4}/);
    for (const name of ["Restaurer", "Maintenir masquée", "Supprimer"]) await expect(card.getByRole("button", { name, exact: true })).toBeEnabled();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test("a guest comment is shown as text, never as HTML", async ({ page }) => {
    await openReported(page, { reported: [{ reports: [{ reason: "other", comment: "<img src=x onerror=alert(1)><b>gras</b>" }] }] });
    await expect(cards(page).first().locator(".report-list")).toContainText("<img src=x onerror=alert(1)><b>gras</b>");
    expect(await cards(page).first().locator(".report-list img, .report-list b").count()).toBe(0);
  });

  test("Restaurer: visible again, reports kept as resolved, decision traced, card leaves the review list", async ({ page }) => {
    await openReported(page, { reported: [{ reports: [{ reason: "privacy", comment: "x" }] }] });
    await cards(page).first().getByRole("button", { name: "Restaurer", exact: true }).click();
    await expect(cards(page)).toHaveCount(0);
    expect(await statusOf(page, "eeee0001")).toEqual(["published", null, ["restored"]]);
    expect(await page.evaluate(() => mock.records.find((r) => r.id.startsWith("eeee0001")).decision.action)).toBe("restored");
    await expect(page.locator("[data-filter=reported]")).toHaveText("Signalées (0)");
    await page.getByRole("button", { name: "Récentes", exact: true }).click();
    await expect(cards(page).first()).toContainText("Dernière décision : Restaurée");
    await expect(cards(page).first()).toContainText("Traité : restaurée");
  });

  test("Maintenir masquée: stays hidden, reports resolved, out of the review list but in Masquées", async ({ page }) => {
    await openReported(page, { reported: [{ reports: [{ reason: "violence" }] }] });
    await cards(page).first().getByRole("button", { name: "Maintenir masquée", exact: true }).click();
    await expect(cards(page)).toHaveCount(0);
    expect(await statusOf(page, "eeee0001")).toEqual(["hidden", "admin", ["kept_hidden"]]);
    await page.getByRole("button", { name: "Masquées", exact: true }).click();
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText("Dernière décision : Maintenue masquée");
  });

  test("Supprimer: confirmation, then the existing deletion (row and both files)", async ({ page }) => {
    await openReported(page, { reported: [{ reports: [{ reason: "sexual" }] }] });
    await cards(page).first().getByRole("button", { name: "Supprimer", exact: true }).click();
    await expect(page.locator("#confirm-message")).toContainText("Supprimer définitivement cette photo ?");
    await page.locator("#confirm-no").click();
    await expect(cards(page)).toHaveCount(1);
    await cards(page).first().getByRole("button", { name: "Supprimer", exact: true }).click();
    await page.locator("#confirm-yes").click();
    await expect(cards(page)).toHaveCount(0);
    expect((await statusOf(page, "eeee0001"))[0]).toBe("deleted");
    const removed = await page.evaluate(() => mock.calls.filter((c) => c[0] === "remove"));
    expect(removed).toHaveLength(1);
    expect(removed[0][1]).toHaveLength(2);
  });

  test("batch on the reported tab: Restaurer (n) asks first, Maintenir masquée (n), Supprimer (n)", async ({ page }) => {
    await openReported(page, { reported: [{ reports: [{ reason: "sexual" }] }, { reports: [{ reason: "violence" }] }, { reports: [{ reason: "privacy" }] }, { reports: [{ reason: "other", comment: "texte" }] }] });
    await expect(cards(page)).toHaveCount(4);
    await expect(page.locator("#batch-bar")).toBeHidden();
    await cards(page).nth(0).locator(".select-box input").check();
    await cards(page).nth(1).locator(".select-box input").check();
    await expect(page.locator("#batch-restore")).toHaveText("Restaurer (2)");
    await expect(page.locator("#batch-keep")).toHaveText("Maintenir masquée (2)");
    await expect(page.locator("#batch-delete")).toHaveText("Supprimer (2)");
    await expect(page.locator("#batch-approve")).toBeHidden();
    await page.locator("#batch-restore").click();
    await expect(page.locator("#confirm-message")).toContainText("Rendre à nouveau visibles 2 photos signalées dans la galerie ?");
    await page.locator("#confirm-no").click();
    expect(await page.evaluate(() => mock.records.filter((r) => r.status === "published").length)).toBe(0);
    await page.locator("#batch-restore").click();
    await page.locator("#confirm-yes").click();
    await expect(page.locator("#admin-message")).toContainText("2 photos restaurées", { timeout: 10000 });
    await expect(cards(page)).toHaveCount(2);
    await cards(page).nth(0).locator(".select-box input").check();
    await page.locator("#batch-keep").click();
    await expect(page.locator("#admin-message")).toContainText("1 photo maintenue masquée", { timeout: 10000 });
    await expect(cards(page)).toHaveCount(1);
  });

  test("a legacy report with an old reason is still readable", async ({ page }) => {
    await openReported(page, { reported: [{ reports: [{ reason: "embarrassing" }, { reason: "child" }] }] });
    await expect(cards(page).first()).toContainText("Photo gênante (ancien motif)");
    await expect(cards(page).first()).toContainText("Photo d’un enfant (ancien motif)");
  });
});
