// Share page: fixed send bar with an explicit destination choice (nothing preselected).
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installMock } from "./mock.js";

const fixture = (name) => `fixtures/${name}`;
const bar = (page) => page.locator("#send-bar");
const status = (page) => page.locator("#upload-status");
const settled = (page, timeout = 40000) =>
  expect(page.locator("#upload-message")).toHaveAttribute("data-kind", /success|pending|error/, { timeout });
const rect = (page, selector) =>
  page.locator(selector).evaluate((n) => {
    const r = n.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom };
  });
const registers = (page) => page.evaluate(() => mock.calls.filter((c) => c[0] === "register_photo"));
async function selectPhotos(page, names) {
  await page.goto("/#partager");
  await page.locator("#files").setInputFiles(names.map(fixture));
  await expect(bar(page)).toBeVisible();
}

test("no bar without photos; with photos it is fixed at the bottom, visible without scrolling, thumb-sized", async ({ page }) => {
  await installMock(page);
  await page.goto("/#partager");
  await expect(bar(page)).toBeHidden();
  await page.locator("#files").setInputFiles([fixture("photo_01.jpg")]);
  await expect(bar(page)).toBeVisible();
  const vh = page.viewportSize().height;
  const b = await rect(page, "#send-bar");
  expect(Math.round(b.bottom)).toBe(vh);
  await expect(page.locator("#send")).toBeInViewport({ ratio: 1 });
  expect((await rect(page, "#send")).h).toBeGreaterThanOrEqual(52);
  for (const value of ["public", "maries"]) {
    const card = await page.locator(`[name=audience][value=${value}]`).locator("xpath=..").evaluate((n) => { const r = n.getBoundingClientRect(); return [r.width, r.height]; });
    expect(card[1]).toBeGreaterThanOrEqual(52);
    expect(card[0]).toBeGreaterThanOrEqual(120);
  }
  // The bar stays within a sensible part of the screen.
  expect(b.h).toBeLessThan(vh * 0.6);
});

test("the bar never hides the content: the last selected photo scrolls above it", async ({ page }) => {
  await installMock(page);
  await selectPhotos(page, ["photo_01.jpg", "photo_02.jpg", "photo_03.jpg", "rafale_a.jpg", "rafale_b.jpg", "portrait_exif6.jpg"]);
  await expect(page.locator("#selection li")).toHaveCount(6, { timeout: 20000 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const barTop = (await rect(page, "#send-bar")).y;
  await expect
    .poll(() => page.locator("#selection li").last().evaluate((n) => n.getBoundingClientRect().bottom), { timeout: 5000 })
    .toBeLessThanOrEqual(barTop + 1);
});

test("nothing preselected: help text, inactive send button, and no way to send without a choice", async ({ page }) => {
  await installMock(page);
  await selectPhotos(page, ["photo_01.jpg", "photo_02.jpg"]);
  await expect(page.locator("[name=audience]:checked")).toHaveCount(0);
  await expect(page.locator("#send-help")).toHaveText("Choisissez où envoyer vos photos");
  await expect(page.locator("#send")).toBeDisabled();
  await expect(page.locator("#send")).toHaveText("Envoyer mes photos");
  // Even a forced submit (Enter key, script) sends nothing.
  await page.evaluate(() => document.getElementById("upload-form").requestSubmit());
  await page.waitForTimeout(600);
  expect((await registers(page)).length).toBe(0);
  await page.locator("[name=audience][value=public]").check();
  await expect(page.locator("#send")).toBeEnabled();
  await expect(page.locator("#send-help")).toBeHidden();
});

test("the destination can be changed until sending starts; the summary recalls it; singular wording", async ({ page }) => {
  await installMock(page);
  await selectPhotos(page, ["photo_01.jpg"]);
  await page.locator("[name=audience][value=public]").check();
  await expect(page.locator("#preview-summary")).toHaveText("1 photo à envoyer · Destination : Partager avec tous les invités (galerie commune)");
  await page.locator("[name=audience][value=maries]").check();
  await expect(page.locator("#preview-summary")).toHaveText("1 photo à envoyer · Destination : Envoyer uniquement aux mariés (privé)");
  await expect(page.locator("#send")).toHaveText("Envoyer mes photos");
  await page.locator("#send").click();
  await settled(page);
  const records = await page.evaluate(() => mock.records.map((r) => r.audience));
  expect(records).toEqual(["maries"]);
  expect(await page.evaluate(() => [...mock.objects.keys()].every((p) => p.startsWith("maries/")))).toBeTruthy();
});

test("public send goes to the public destination for every photo of the selection", async ({ page }) => {
  await installMock(page);
  await selectPhotos(page, ["photo_01.jpg", "photo_02.jpg"]);
  await page.locator("[name=audience][value=public]").check();
  await page.locator("#send").click();
  await settled(page);
  const calls = await registers(page);
  expect(calls).toHaveLength(2);
  expect(calls.every((c) => c[1].p_audience === "public")).toBeTruthy();
  expect(await page.evaluate(() => [...mock.objects.keys()].every((p) => p.startsWith("public/")))).toBeTruthy();
});

test("after a successful send the choice is forgotten and the bar goes away", async ({ page }) => {
  await installMock(page);
  await selectPhotos(page, ["photo_01.jpg"]);
  await page.locator("[name=audience][value=maries]").check();
  await page.locator("#send").click();
  await settled(page);
  await expect(bar(page)).toBeHidden();
  await expect(page.locator("[name=audience]:checked")).toHaveCount(0);
  // Second send: a deliberate choice is required again.
  await page.locator("#files").setInputFiles([fixture("photo_02.jpg")]);
  await expect(bar(page)).toBeVisible();
  await expect(page.locator("[name=audience]:checked")).toHaveCount(0);
  await expect(page.locator("#send")).toBeDisabled();
  await expect(page.locator("#send")).toHaveText("Envoyer mes photos");
  await page.locator("[name=audience][value=public]").check();
  await page.locator("#send").click();
  await settled(page);
  const audiences = await page.evaluate(() => mock.records.map((r) => r.audience).sort());
  expect(audiences).toEqual(["maries", "public"]);
});

test("one send path: a double tap or double submit sends each photo once", async ({ page }) => {
  await installMock(page, { uploadDelay: 150 });
  await selectPhotos(page, ["photo_01.jpg", "photo_02.jpg"]);
  await page.locator("[name=audience][value=public]").check();
  expect(await page.locator("#send").count()).toBe(1);
  await page.locator("#send").dblclick();
  await page.evaluate(() => document.getElementById("upload-form").requestSubmit());
  await settled(page);
  expect(await registers(page)).toHaveLength(2);
  expect(await page.evaluate(() => mock.records.length)).toBe(2);
});

test("while sending: the bar shows the existing progress and Cancel instead of the choice", async ({ page }) => {
  await installMock(page, { uploadDelay: 400 });
  await selectPhotos(page, ["photo_01.jpg", "photo_02.jpg", "photo_03.jpg"]);
  await page.locator("[name=audience][value=public]").check();
  await page.locator("#send").click();
  await expect(bar(page)).toBeVisible();
  await expect(page.locator("#send-bar #progress-panel")).toBeVisible();
  await expect(page.locator("#send-bar #cancel-upload")).toBeVisible();
  await expect(page.locator("#send-choice")).toBeHidden();
  expect((await rect(page, "#cancel-upload")).h).toBeGreaterThanOrEqual(44);
  await page.locator("#cancel-upload").click();
  await expect(status(page)).toContainText("Envoi arrêté", { timeout: 20000 });
  await expect(page.locator("#progress-panel")).toBeHidden();
  await expect(bar(page)).toBeVisible(); // unprocessed photos remain: the bar offers to send them
});

test("partial failure then retry keep the destination", async ({ page }) => {
  await installMock(page, { failures: 3 });
  await selectPhotos(page, ["photo_03.jpg", "photo_02.jpg"]);
  await page.locator("[name=audience][value=maries]").check();
  await page.locator("#send").click();
  await settled(page);
  await expect(page.locator("#upload-message")).toHaveAttribute("data-kind", "error");
  // The failed photo is still listed, the choice is still "maries", and the bar offers the retry.
  await expect(page.locator("#selection li")).toHaveCount(1);
  await expect(page.locator("[name=audience][value=maries]")).toBeChecked();
  await expect(bar(page)).toBeVisible();
  await expect(page.locator("#send")).toHaveText("Réessayer les photos en échec");
  await expect(page.locator("#preview-summary")).toContainText("Envoyer uniquement aux mariés");
  await expect(page.locator("#send")).toBeEnabled();
  await page.locator("#send").click();
  await settled(page);
  const audiences = await page.evaluate(() => mock.records.map((r) => r.audience));
  expect(audiences).toEqual(["maries", "maries"]);
  await expect(page.locator("[name=audience]:checked")).toHaveCount(0);
  await expect(bar(page)).toBeHidden();
});

test("duplicates stay separate between destinations", async ({ page }) => {
  await installMock(page);
  await selectPhotos(page, ["photo_01.jpg"]);
  await page.locator("[name=audience][value=public]").check();
  await page.locator("#send").click();
  await settled(page);
  await page.locator("#files").setInputFiles([fixture("photo_01.jpg")]);
  await page.locator("[name=audience][value=maries]").check();
  await page.locator("#send").click();
  await settled(page);
  await expect(status(page)).toContainText("1 photo envoyée aux mariés");
  await expect(status(page)).not.toContainText("doublon");
  await page.locator("#files").setInputFiles([fixture("photo_01.jpg")]);
  await page.locator("[name=audience][value=public]").check();
  await page.locator("#send").click();
  await settled(page);
  await expect(status(page)).toContainText("1 doublon ignoré");
});

test("accessibility: real radio group with a legend, keyboard use, focus ring, axe-core clean", async ({ page, isMobile }) => {
  await installMock(page);
  await selectPhotos(page, ["photo_01.jpg"]);
  const group = page.getByRole("group", { name: "Destination (modifiable avant l’envoi)" });
  await expect(group).toBeVisible();
  await expect(group.getByRole("radio")).toHaveCount(2);
  await expect(group.getByRole("radio", { name: /Partager avec tous les invités/ })).not.toBeChecked();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  if (!isMobile) {
    await page.locator("[name=audience][value=public]").focus();
    await page.keyboard.press("ArrowRight"); // native radio group navigation selects the next option
    await expect(page.locator("[name=audience][value=maries]")).toBeChecked();
    expect(await page.locator("[name=audience][value=maries]").locator("xpath=..").evaluate((n) => getComputedStyle(n).outlineStyle)).not.toBe("none");
  }
  await page.locator("[name=audience][value=public]").check();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await expect(page.locator("#send")).toBeEnabled();
});

test("the unreadable file alone does not raise the bar", async ({ page }) => {
  await installMock(page);
  await page.goto("/#partager");
  await page.locator("#files").setInputFiles([{ name: "x.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not an image") }]);
  await expect(page.locator("#upload-message")).toHaveAttribute("data-kind", "error");
  await expect(bar(page)).toBeHidden();
});
