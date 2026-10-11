// Upload status messages: one block, one message at a time (success 5 s, pending 10 s with OK, errors stay).
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { installMock, chooseDestination } from "./mock.js";

const fixture = (name) => `fixtures/${name}`;
const box = (page) => page.locator("#upload-message");
const status = (page) => page.locator("#upload-status");
const settled = (page, timeout = 30000) =>
  expect(box(page)).toHaveAttribute("data-kind", /success|pending|error/, { timeout });
async function sendOne(page, name = "photo_01.jpg") {
  await page.locator("#files").setInputFiles([fixture(name)]);
  await chooseDestination(page);
  await expect(page.locator("#send")).toBeEnabled();
  await page.locator("#send").click();
}

test("complete success: brief confirmation, polite live region, disappears by itself after about 5 s", async ({ page }) => {
  await installMock(page);
  await page.goto("/#partager");
  await expect(status(page)).toHaveAttribute("aria-live", "polite");
  await expect(status(page)).toHaveAttribute("role", "status");
  await sendOne(page);
  await settled(page);
  await expect(status(page)).toHaveText("Merci ! Votre photo a bien été ajoutée à la galerie.");
  await expect(box(page)).toHaveAttribute("data-kind", "success");
  await expect(page.locator("#message-close")).toBeHidden();
  await expect(page.locator("#message-retry")).toBeHidden();
  await expect(page.locator("#progress-panel")).toBeHidden();
  await page.waitForTimeout(3000);
  await expect(status(page)).not.toBeEmpty(); // still there at 3 s
  await expect(status(page)).toBeEmpty({ timeout: 6000 }); // gone shortly after 5 s
  await expect(box(page)).not.toHaveClass(/is-open/);
});

test("success fade is a soft transition, and none with prefers-reduced-motion", async ({ page }) => {
  await installMock(page);
  await page.goto("/#partager");
  await sendOne(page);
  await settled(page);
  expect(await box(page).evaluate((n) => parseFloat(getComputedStyle(n).transitionDuration))).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await box(page).evaluate((n) => parseFloat(getComputedStyle(n).transitionDuration))).toBe(0);
});

test("kept for review: one-sentence reason, OK button, closes by itself after about 10 s", async ({ page }) => {
  await installMock(page, { model: "unavailable" });
  await page.goto("/#partager");
  await sendOne(page);
  await settled(page);
  await expect(box(page)).toHaveAttribute("data-kind", "pending");
  await expect(status(page)).toContainText("1 photo reçue : elle apparaîtra dans la galerie après vérification par les organisateurs.");
  await expect(page.locator("#message-close")).toHaveText("OK");
  await expect(page.locator("#message-retry")).toBeHidden();
  await page.locator("#message-close").click();
  await expect(status(page)).toBeEmpty({ timeout: 3000 });
  // Second send, no click: stays past 5 s, gone after about 10 s.
  await sendOne(page, "photo_02.jpg");
  await settled(page);
  await page.waitForTimeout(6500);
  await expect(status(page)).not.toBeEmpty();
  await expect(status(page)).toBeEmpty({ timeout: 6000 });
});

test("failure never disappears by itself; reason, count, retry and close; successes counted apart", async ({ page }) => {
  await installMock(page, { failures: 3 });
  await page.goto("/#partager");
  await page.locator("#files").setInputFiles([fixture("photo_03.jpg"), fixture("photo_02.jpg")]);
  await chooseDestination(page);
  await page.locator("#send").click();
  await settled(page, 40000);
  await expect(box(page)).toHaveAttribute("data-kind", "error");
  await expect(status(page)).toContainText("1 photo n’a pas pu être envoyée.");
  await expect(status(page)).toContainText("Raison :");
  await expect(status(page)).toContainText("Bien reçues : 1 photo ajoutée à la galerie");
  await expect(page.locator("#message-retry")).toBeVisible();
  await expect(page.locator("#message-retry")).toHaveText(/Réessayer les échecs/);
  await expect(page.locator("#message-close")).toBeVisible();
  await expect(page.locator("#retry")).toBeHidden(); // no second copy of the same action
  await page.waitForTimeout(12000);
  await expect(box(page)).toHaveAttribute("data-kind", "error");
  await expect(status(page)).not.toBeEmpty();
  // Closing keeps the retry reachable from the toolbar.
  await page.locator("#message-close").click();
  await expect(status(page)).toBeEmpty({ timeout: 3000 });
  await expect(page.locator("#retry")).toBeVisible();
  await page.locator("#retry").click();
  await settled(page);
  await expect(box(page)).toHaveAttribute("data-kind", "success");
  await expect(status(page)).toContainText("Merci ! Votre photo a bien été ajoutée à la galerie.");
});

test("mixed send (success + network failure + duplicate + unreadable file) gives one coherent message", async ({ page }) => {
  await installMock(page, { failures: 3 });
  await page.goto("/#partager");
  const bytes = await readFile(fixture("photo_02.jpg"));
  await page.locator("#files").setInputFiles([
    { name: "a.jpg", mimeType: "image/jpeg", buffer: await readFile(fixture("photo_03.jpg")) },
    { name: "b.jpg", mimeType: "image/jpeg", buffer: bytes },
    { name: "b-copie.jpg", mimeType: "image/jpeg", buffer: bytes },
    fixture("pas_une_image.jpg"),
  ].map((f) => (typeof f === "string" ? { name: "pas_une_image.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not an image") } : f)));
  // The unreadable file is reported at selection, as an error that stays.
  await expect(box(page)).toHaveAttribute("data-kind", "error");
  await expect(status(page)).toContainText("1 fichier n’a pas pu être utilisé");
  await chooseDestination(page);
  await page.locator("#send").click();
  await settled(page, 40000);
  await expect(page.locator("#upload-message")).toHaveCount(1);
  await expect(page.locator("#progress-panel")).toBeHidden();
  await expect(box(page)).toHaveAttribute("data-kind", "error");
  const text = await status(page).textContent();
  expect(text).toContain("2 photos n’ont pas pu être envoyées");
  expect(text).toContain("1 photo ajoutée à la galerie");
  expect(text).toContain("1 doublon ignoré");
  expect(text).not.toMatch(/Terminé|erreur de doublon/i);
  await expect(page.locator("#message-retry")).toBeVisible();
  await expect(page.locator("#message-close")).toBeVisible();
});

test("a new send replaces the previous message; a later success never erases an unresolved error", async ({ page }) => {
  await installMock(page, { failures: 3 });
  await page.goto("/#partager");
  await sendOne(page, "photo_01.jpg"); // fails after 3 attempts
  await settled(page, 40000);
  await expect(box(page)).toHaveAttribute("data-kind", "error");
  // Another send while the error is shown: the progress block replaces it, then ONE final message, still an error.
  await page.locator("#files").setInputFiles([fixture("photo_02.jpg")]);
  await expect(box(page)).toHaveAttribute("data-kind", "error"); // information does not replace an error
  await chooseDestination(page);
  await page.locator("#send").click();
  await settled(page, 40000);
  await expect(page.locator("#upload-message")).toHaveCount(1);
  await expect(box(page)).toHaveAttribute("data-kind", "error");
  await expect(status(page)).toContainText("1 photo n’a pas pu être envoyée");
  await expect(status(page)).toContainText("Bien reçues : 1 photo ajoutée à la galerie");
  // Success then new success: replaced, not stacked.
  await page.locator("#message-retry").click();
  await settled(page, 40000);
  await expect(box(page)).toHaveAttribute("data-kind", "success");
  await sendOne(page, "photo_03.jpg");
  await settled(page);
  await expect(status(page)).toHaveText("Merci ! Votre photo a bien été ajoutée à la galerie.");
  await expect(page.locator("#upload-status")).toHaveCount(1);
});

test("the progress block gives way to the final message: never both visible", async ({ page }) => {
  await installMock(page, { uploadDelay: 300 });
  await page.goto("/#partager");
  await page.evaluate(() => {
    window.__both = false;
    const check = () => {
      const progress = !document.getElementById("progress-panel").hidden;
      const finalKind = /success|pending|error/.test(document.getElementById("upload-message").dataset.kind || "");
      if (progress && finalKind) window.__both = true;
    };
    new MutationObserver(check).observe(document.body, { attributes: true, subtree: true, childList: true, characterData: true });
  });
  await sendOne(page);
  await expect(page.locator("#progress-panel")).toBeVisible();
  await settled(page);
  await expect(page.locator("#progress-panel")).toBeHidden();
  expect(await page.evaluate(() => window.__both)).toBeFalsy();
});

test("rate limit anomaly is explained in plain French and stays", async ({ page }) => {
  await installMock(page, { rateLimited: true });
  await page.goto("/#partager");
  await sendOne(page);
  await settled(page);
  await expect(box(page)).toHaveAttribute("data-kind", "error");
  await expect(status(page)).toContainText("Trop de photos envoyées, réessayez plus tard");
  await expect(status(page)).toContainText("1 photo n’a pas pu être envoyée");
  await page.waitForTimeout(6000);
  await expect(status(page)).not.toBeEmpty();
});

// ---- Selection after sending --------------------------------------------------------------------------
const selected = (page) => page.locator("#selection li");
const fileValue = (page) => page.locator("#files").evaluate((input) => input.value);

test("everything sent: list emptied and hidden, file field reset, plain thank-you (singular and plural)", async ({ page }) => {
  await installMock(page);
  await page.goto("/#partager");
  await expect(page.locator("#selection")).toBeHidden(); // nothing selected yet: no block
  await page.locator("#files").setInputFiles([fixture("photo_01.jpg")]);
  await expect(selected(page)).toHaveCount(1);
  await expect(page.locator("#selection")).toBeVisible();
  await expect(page.locator("#selection-title")).toHaveText("Vos photos sélectionnées (1)");
  await chooseDestination(page);
  await page.locator("#send").click();
  await settled(page);
  await expect(status(page)).toHaveText("Merci ! Votre photo a bien été ajoutée à la galerie.");
  await expect(selected(page)).toHaveCount(0);
  await expect(page.locator("#selection")).toBeHidden();
  await expect(page.locator("#selection-title")).toBeHidden();
  expect(await fileValue(page)).toBe("");
  await expect(page.locator("#send")).toBeDisabled();
  // Several photos: plural.
  await page.locator("#files").setInputFiles([fixture("photo_02.jpg"), fixture("photo_03.jpg")]);
  await chooseDestination(page);
  await page.locator("#send").click();
  await settled(page);
  await expect(status(page)).toHaveText("Merci ! Vos 2 photos ont bien été ajoutées à la galerie.");
  await expect(selected(page)).toHaveCount(0);
  // The thank-you goes away by itself.
  await expect(status(page)).toBeEmpty({ timeout: 8000 });
});

test("the next selection replaces the thank-you straight away", async ({ page }) => {
  await installMock(page);
  await page.goto("/#partager");
  await sendOne(page);
  await settled(page);
  await expect(status(page)).toContainText("Merci !");
  await page.locator("#files").setInputFiles([fixture("photo_02.jpg")]);
  await expect(status(page)).not.toContainText("Merci !");
  await expect(status(page)).toContainText("1 photo(s) prête(s)");
  await expect(selected(page)).toHaveCount(1);
});

test("partial failure: only the failed photo stays, with its error and a way to retry; sent ones leave", async ({ page }) => {
  await installMock(page, { failures: 3 });
  await page.goto("/#partager");
  await page.locator("#files").setInputFiles([fixture("photo_03.jpg"), fixture("photo_02.jpg")]);
  await expect(selected(page)).toHaveCount(2);
  await chooseDestination(page);
  await page.locator("#send").click();
  await settled(page, 40000);
  await expect(box(page)).toHaveAttribute("data-kind", "error");
  await expect(selected(page)).toHaveCount(1);
  await expect(selected(page).first()).toContainText("photo_03.jpg");
  await expect(selected(page).first()).toContainText("Échec");
  await expect(page.locator("#selection-title")).toHaveText("Vos photos sélectionnées (1)");
  await expect(page.locator("#message-retry")).toBeVisible();
  await expect(status(page)).toContainText("Bien reçues : 1 photo ajoutée à la galerie");
  // Retry sends the remaining one; the list is then empty and hidden.
  await page.locator("#message-retry").click();
  await settled(page, 40000);
  await expect(status(page)).toHaveText("Merci ! Votre photo a bien été ajoutée à la galerie.");
  await expect(selected(page)).toHaveCount(0);
  await expect(page.locator("#selection")).toBeHidden();
  expect(await fileValue(page)).toBe("");
});

test("the same file can be chosen twice in a row (the field is reset after sending)", async ({ page }) => {
  await installMock(page);
  await page.goto("/#partager");
  await page.locator("#files").setInputFiles([fixture("photo_01.jpg")]);
  await expect(selected(page)).toHaveCount(1);
  await chooseDestination(page);
  await page.locator("#send").click();
  await settled(page);
  expect(await fileValue(page)).toBe("");
  await expect(selected(page)).toHaveCount(0);
  // Same file again: accepted as a new selection (the guest is told it is a duplicate once sent).
  await page.locator("#files").setInputFiles([fixture("photo_01.jpg")]);
  await expect(selected(page)).toHaveCount(1);
  await chooseDestination(page);
  await expect(page.locator("#send")).toBeEnabled();
  await page.locator("#send").click();
  await settled(page);
  await expect(status(page)).toContainText("1 doublon ignoré");
  await expect(selected(page)).toHaveCount(0);
  expect(await fileValue(page)).toBe("");
  // And a third time, after the duplicate message.
  await page.locator("#files").setInputFiles([fixture("photo_01.jpg")]);
  await expect(selected(page)).toHaveCount(1);
});

test("photos sent from the share page appear in the gallery without reloading", async ({ page }) => {
  await installMock(page, { photos: 2 });
  await page.goto("/");
  await expect(page.locator("#gallery .photo-card")).toHaveCount(2);
  await page.getByRole("link", { name: "Partager des photos", exact: true }).click();
  await sendOne(page, "photo_03.jpg");
  await settled(page);
  await expect(selected(page)).toHaveCount(0);
  await page.getByRole("link", { name: "Accueil", exact: true }).click();
  await expect(page.locator("#gallery .photo-card")).toHaveCount(3);
});

// ---- Guest wording when the photo waits for validation ---------------------------------------------------
test("validation mode: plain thank-you for one photo and for several, with OK, and the list is emptied", async ({ page }) => {
  await installMock(page, { paused: true });
  await page.goto("/#partager");
  await sendOne(page);
  await settled(page);
  await expect(box(page)).toHaveAttribute("data-kind", "pending");
  await expect(status(page)).toHaveText("Merci ! Votre photo sera visible après validation.");
  await expect(page.locator("#message-close")).toHaveText("OK");
  await expect(page.locator("#selection li")).toHaveCount(0);
  await page.locator("#message-close").click();
  await page.locator("#files").setInputFiles([fixture("photo_02.jpg"), fixture("photo_03.jpg")]);
  await chooseDestination(page);
  await page.locator("#send").click();
  await settled(page);
  await expect(status(page)).toHaveText("Merci ! Vos 2 photos seront visibles après validation.");
});

test("a photo flagged by the automatic filter gets the same wording", async ({ page }) => {
  await installMock(page, { model: "suspect" });
  await page.goto("/#partager");
  await sendOne(page);
  await settled(page);
  await expect(box(page)).toHaveAttribute("data-kind", "pending");
  await expect(status(page)).toHaveText("Merci ! Votre photo sera visible après validation.");
});

test("model unavailable keeps its previous wording; a clean photo without validation keeps the gallery thank-you", async ({ page }) => {
  await installMock(page, { model: "unavailable" });
  await page.goto("/#partager");
  await sendOne(page);
  await settled(page);
  await expect(status(page)).toContainText("après vérification par les organisateurs");
  await expect(status(page)).not.toContainText("Merci ! Votre photo sera visible après validation.");
  await page.locator("#message-close").click();
  const other = await page.context().newPage();
  await installMock(other);
  await other.goto("/#partager");
  await other.locator("#files").setInputFiles([fixture("photo_02.jpg")]);
  await chooseDestination(other);
  await other.locator("#send").click();
  await expect(other.locator("#upload-status")).toHaveText("Merci ! Votre photo a bien été ajoutée à la galerie.");
});

test("validation mode never turns a failure into a success message", async ({ page }) => {
  await installMock(page, { paused: true, failures: 3 });
  await page.goto("/#partager");
  await sendOne(page);
  await settled(page, 40000);
  await expect(box(page)).toHaveAttribute("data-kind", "error");
  await expect(status(page)).not.toContainText("Merci !");
});
