// Share journey: "Partager mes photos" -> choose public / private -> pick files -> preview -> confirm.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installMock, navLink } from "./mock.js";

const fixture = (name) => `fixtures/${name}`;
const settled = (page, timeout = 40000) =>
  expect(page.locator("#upload-message")).toHaveAttribute("data-kind", /success|pending|error|info/, { timeout });
const sends = (page) => page.evaluate(() => mock.calls.filter((c) => c[0] === "upload" || c[0] === "register_photo").length);
async function watchChoosers(page) {
  const state = { count: 0 };
  page.on("filechooser", () => state.count++);
  return state;
}
/** Records whether the file input was opened while the user gesture was still active. */
async function trackInputClicks(page) {
  await page.evaluate(() => {
    window.__inputClicks = [];
    const original = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function (...args) {
      if (this.type === "file") window.__inputClicks.push({ active: navigator.userActivation?.isActive ?? null, id: this.id });
      return original.apply(this, args);
    };
  });
}
async function pick(page, value, files) {
  const chooser = page.waitForEvent("filechooser");
  await page.locator(`[data-destination=${value}]`).click();
  await (await chooser).setFiles(files.map(fixture));
}
const expectStepOne = async (page) => {
  await expect(page.locator("#share-view")).toBeVisible();
  await expect(page.locator("#choose-title")).toHaveText("Où souhaitez-vous partager vos photos ?");
  await expect(page.locator("[data-destination]")).toHaveCount(2);
  await expect(page.locator("[data-destination=public]")).toBeVisible();
  await expect(page.locator("[data-destination=maries]")).toBeVisible();
  await expect(page.locator("[name=audience]:checked")).toHaveCount(0);
  await expect(page.locator("#send-bar")).toBeHidden();
};

test.describe("step 1 from every entry point: destination cards, no chooser, nothing preselected, nothing sent", () => {
  test("hero button on the home page", async ({ page }) => {
    await installMock(page, { photos: 2 });
    await page.goto("/");
    const choosers = await watchChoosers(page);
    await page.locator(".hero-cta").click();
    await expectStepOne(page);
    await page.waitForTimeout(500);
    expect(choosers.count).toBe(0);
    expect(await sends(page)).toBe(0);
  });
  test("floating bar of the gallery (mobile) or menu link", async ({ page }) => {
    await installMock(page, { photos: 40 });
    await page.goto("/");
    const choosers = await watchChoosers(page);
    if (page.viewportSize().width < 640) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await expect(page.locator("#fab-bar .fab")).toBeVisible();
      await page.locator("#fab-bar .fab").click();
    } else {
      await navLink(page, "Partager des photos");
    }
    await expectStepOne(page);
    await page.waitForTimeout(500);
    expect(choosers.count).toBe(0);
  });
  test("menu link, and a direct visit of /#partager", async ({ page }) => {
    await installMock(page);
    await page.goto("/");
    const choosers = await watchChoosers(page);
    await navLink(page, "Partager des photos");
    await expectStepOne(page);
    await navLink(page, "Accueil");
    await page.goto("/#partager");
    await expectStepOne(page);
    expect(choosers.count).toBe(0);
    expect(await sends(page)).toBe(0);
  });
  test("the page has no label or element that can open the chooser by itself", async ({ page }) => {
    await installMock(page);
    await page.goto("/#partager");
    const audit = await page.evaluate(() => {
      const input = document.getElementById("files");
      return {
        labelsFor: document.querySelectorAll('label[for="files"]').length,
        insideLabel: Boolean(input.closest("label")),
        hidden: input.getAttribute("aria-hidden"),
        tabindex: input.getAttribute("tabindex"),
        fileInputs: document.querySelectorAll('input[type="file"]').length,
      };
    });
    expect(audit).toEqual({ labelsFor: 0, insideLabel: false, hidden: "true", tabindex: "-1", fileInputs: 1 });
  });
  test("accessibility of step 1 (axe-core) and a real named group of two buttons", async ({ page }) => {
    await installMock(page);
    await page.goto("/#partager");
    await expect(page.getByRole("group", { name: "Où souhaitez-vous partager vos photos ?" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Partager avec tous les invités/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Envoyer uniquement aux mariés/ })).toBeVisible();
    await expect(page.locator("[data-destination=public]")).toContainText("Vos photos rejoindront la galerie commune après les contrôles éventuels.");
    await expect(page.locator("[data-destination=maries]")).toContainText("Vos photos resteront privées et seront visibles uniquement par Thomas et Aziliz.");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const a = await page.locator("[data-destination=public]").boundingBox();
    const b = await page.locator("[data-destination=maries]").boundingBox();
    expect(Math.min(a.height, b.height)).toBeGreaterThanOrEqual(100);
    expect(Math.min(a.width, b.width)).toBeGreaterThanOrEqual(240);
  });
});

for (const value of ["public", "maries"]) {
  test(`a click on the '${value}' card opens the chooser, directly inside the user gesture`, async ({ page }) => {
    await installMock(page);
    await page.goto("/#partager");
    await trackInputClicks(page);
    const chooser = page.waitForEvent("filechooser");
    await page.locator(`[data-destination=${value}]`).click();
    const fileChooser = await chooser;
    expect(fileChooser.isMultiple()).toBeTruthy();
    // The destination is stored at once...
    await expect(page.locator(`[name=audience][value=${value}]`)).toBeChecked();
    // ...and the chooser was opened while the click's user activation was still live (no timer / await in between).
    const clicks = await page.evaluate(() => window.__inputClicks);
    expect(clicks).toEqual([{ active: true, id: "files" }]);
    expect(await sends(page)).toBe(0);
  });
}

test("cancelling the chooser sends nothing, keeps both destinations, and allows another try", async ({ page }) => {
  await installMock(page);
  await page.goto("/#partager");
  const chooser = page.waitForEvent("filechooser");
  await page.locator("[data-destination=public]").click();
  await chooser;
  await page.evaluate(() => document.getElementById("files").dispatchEvent(new Event("cancel")));
  await page.waitForTimeout(500);
  await expectStepOne(page);
  expect(await sends(page)).toBe(0);
  // Try again with the other destination.
  await pick(page, "maries", ["photo_01.jpg"]);
  await expect(page.locator("[name=audience][value=maries]")).toBeChecked();
});

test("an empty selection behaves like a cancel", async ({ page }) => {
  await installMock(page);
  await page.goto("/#partager");
  const chooser = page.waitForEvent("filechooser");
  await page.locator("[data-destination=public]").click();
  await (await chooser).setFiles([]);
  await page.waitForTimeout(500);
  await expectStepOne(page);
  expect(await sends(page)).toBe(0);
});

test("several photos: previews, count, destination, removal; nothing is sent before 'Envoyer mes photos'", async ({ page }) => {
  await installMock(page);
  await page.goto("/#partager");
  await pick(page, "public", ["photo_01.jpg", "photo_02.jpg", "photo_03.jpg"]);
  await expect(page.locator("#selection li")).toHaveCount(3, { timeout: 20000 });
  await expect(page.locator("#selection li img")).toHaveCount(3);
  await expect(page.locator("#selection-title")).toHaveText("Vos photos sélectionnées (3)");
  await expect(page.locator("#preview-summary")).toHaveText("3 photos à envoyer · Destination : Partager avec tous les invités (galerie commune)");
  await expect(page.locator("#choose-step")).toBeHidden();
  await expect(page.locator("#send")).toHaveText("Envoyer mes photos");
  await page.waitForTimeout(1500);
  expect(await sends(page)).toBe(0); // no automatic upload
  await page.getByRole("button", { name: /^Retirer photo_02/ }).click();
  await expect(page.locator("#selection li")).toHaveCount(2);
  await expect(page.locator("#preview-summary")).toContainText("2 photos à envoyer");
  expect(await sends(page)).toBe(0);
  await page.locator("#send").click();
  await settled(page);
  expect(await sends(page)).toBeGreaterThan(0);
  expect(await page.evaluate(() => mock.records.length)).toBe(2);
});

test("'+ Ajouter d'autres photos' reuses the chosen destination", async ({ page }) => {
  await installMock(page);
  await page.goto("/#partager");
  await pick(page, "maries", ["photo_01.jpg"]);
  await expect(page.locator("#selection li")).toHaveCount(1);
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#add-more").click();
  await (await chooser).setFiles([fixture("photo_02.jpg")]);
  await expect(page.locator("#selection li")).toHaveCount(2);
  await expect(page.locator("[name=audience][value=maries]")).toBeChecked();
  await expect(page.locator("#preview-summary")).toContainText("Envoyer uniquement aux mariés");
});

test("public send: audience 'public' and public paths; private send: audience 'maries', private paths, absent from the gallery", async ({ page }) => {
  await installMock(page, { photos: 1 });
  await page.goto("/");
  await expect(page.locator("#gallery .photo-card")).toHaveCount(1);
  await navLink(page, "Partager des photos");
  await pick(page, "public", ["photo_01.jpg"]);
  await page.locator("#send").click();
  await settled(page);
  let calls = await page.evaluate(() => mock.calls.filter((c) => c[0] === "register_photo").map((c) => c[1].p_audience));
  expect(calls).toEqual(["public"]);
  expect(await page.evaluate(() => [...mock.objects.keys()].every((p) => p.startsWith("public/")))).toBeTruthy();
  // Private send.
  await pick(page, "maries", ["photo_02.jpg"]);
  await page.locator("#send").click();
  await settled(page);
  calls = await page.evaluate(() => mock.calls.filter((c) => c[0] === "register_photo").map((c) => c[1].p_audience));
  expect(calls).toEqual(["public", "maries"]);
  const privatePaths = await page.evaluate(() => [...mock.objects.keys()].filter((p) => p.startsWith("maries/")));
  expect(privatePaths).toHaveLength(2); // thumb + full
  expect(await page.evaluate(() => mock.records.find((r) => r.audience === "maries").status)).toBe("published"); // accepted; visibility is audience-based
  await navLink(page, "Accueil");
  await page.locator("#refresh").click();
  // The gallery shows the 1 seeded + 1 public photo, never the private one.
  await expect(page.locator("#gallery .photo-card")).toHaveCount(2);
});

test("changing the destination before confirming applies to every photo and sends nothing by itself", async ({ page }) => {
  await installMock(page);
  await page.goto("/#partager");
  await pick(page, "public", ["photo_01.jpg", "photo_02.jpg"]);
  await expect(page.locator("#selection li")).toHaveCount(2);
  await page.locator("[name=audience][value=maries]").check();
  await expect(page.locator("#preview-summary")).toContainText("Destination : Envoyer uniquement aux mariés (privé)");
  await page.waitForTimeout(800);
  expect(await sends(page)).toBe(0);
  await page.locator("#send").click();
  await settled(page);
  expect(await page.evaluate(() => mock.records.map((r) => r.audience))).toEqual(["maries", "maries"]);
});

test("destination is identical during automatic attempts and after a failure then a retry", async ({ page }) => {
  await installMock(page, { failures: 3 });
  await page.goto("/#partager");
  await pick(page, "maries", ["photo_03.jpg", "photo_02.jpg"]);
  await expect(page.locator("#selection li")).toHaveCount(2);
  await page.locator("#send").click();
  await settled(page);
  await expect(page.locator("#upload-message")).toHaveAttribute("data-kind", "error");
  await expect(page.locator("[name=audience][value=maries]")).toBeChecked();
  await page.locator("#send").click(); // retry from the bar
  await settled(page);
  expect(await page.evaluate(() => mock.records.map((r) => r.audience))).toEqual(["maries", "maries"]);
  // Every upload attempt (3 automatic tries included) used the private folder.
  const uploads = await page.evaluate(() => mock.calls.filter((c) => c[0] === "upload").map((c) => c[1]));
  expect(uploads.length).toBeGreaterThanOrEqual(4);
  expect(uploads.every((p) => p.startsWith("maries/"))).toBeTruthy();
});

test("pressing 'Partager mes photos' again gives back the initial choice; a pending selection is kept with its destination visible", async ({ page }) => {
  await installMock(page);
  await page.goto("/");
  await page.locator(".hero-cta").click();
  await pick(page, "maries", ["photo_01.jpg"]);
  await expect(page.locator("#selection li")).toHaveCount(1);
  // Leave and come back through a share entry point: the unsent photo is not thrown away, destination displayed.
  await navLink(page, "Accueil");
  await page.locator(".hero-cta").click();
  await expect(page.locator("#selection li")).toHaveCount(1);
  await expect(page.locator("#preview-summary")).toContainText("Envoyer uniquement aux mariés");
  // Remove the photo: back to step 1 with no remembered destination.
  await page.getByRole("button", { name: /^Retirer/ }).click();
  await expectStepOne(page);
  // After a completed send: initial choice again, and the same entry point starts fresh.
  await pick(page, "public", ["photo_02.jpg"]);
  await page.locator("#send").click();
  await settled(page);
  await expectStepOne(page);
  await navLink(page, "Accueil");
  await page.locator(".hero-cta").click();
  await expectStepOne(page);
});

test("an unconfigured site disables the cards and says why", async ({ page }) => {
  await page.route("**/config.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "export const NAMES='';export const DATE_TXT='';export const SUPABASE_URL='';export const SUPABASE_KEY='';export const BUCKET='photos';export const SECRET='';export const LOCATION='';export const COUPLE_PHOTO='';export const NSFW_ENABLED=true;",
    }),
  );
  await page.goto("/#partager");
  await expect(page.locator("[data-destination=public]")).toBeDisabled();
  await expect(page.locator("[data-destination=maries]")).toBeDisabled();
  await expect(page.locator("#upload-status")).toContainText("pas encore ouverts");
});
