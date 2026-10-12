// Export des photos (administration) : onglet Export, archives ZIP par lots, annulation, échecs, intégrité, avertissement mobile.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { installMock } from "./mock.js";
import { readZip } from "./zip-helper.js";

const csvRows = (text) => text.trim().split("\r\n").map((line) => line.split(","));
const tabExport = (page) => page.locator("#tab-export");
async function openExport(page, options = {}) {
  await installMock(page, { admin: true, exportUrls: true, distinctCreated: true, ...options });
  await page.goto("/admin.html");
  await expect(page.locator("#dashboard")).toBeVisible();
  await tabExport(page).click();
  await expect(page.locator("#export-panel")).toBeVisible();
}
// Collects every download of the page and saves it under the test output folder.
function collect(page, testInfo) {
  const saved = [];
  page.on("download", async (d) => {
    const path = testInfo.outputPath(d.suggestedFilename());
    saved.push(d.saveAs(path).then(() => ({ name: d.suggestedFilename(), path })));
  });
  return async () => {
    await page.waitForTimeout(300); // let the last download events arrive
    return Promise.all(saved);
  };
}
const summary = (page) => page.locator("#export-summary");

test("Export tab: two folders with their counts, default statuses, reminder that every administrator can open the private folder", async ({ page }) => {
  await openExport(page, { photos: 5, pending: ["nsfw", "paused"], mariesPhotos: 3, reported: [{ reports: [{ reason: "sexual" }] }] });
  await expect(tabExport(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#photos-view")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Galerie commune" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Uniquement aux mariés" })).toBeVisible();
  await expect(page.locator("#export-st-published")).toBeChecked();
  await expect(page.locator("#export-st-pending")).toBeChecked();
  await expect(page.locator("#export-st-hidden")).not.toBeChecked();
  await expect(page.locator("#export-count-public")).toHaveText("7 photos à exporter");
  await expect(page.locator("#export-detail-public")).toContainText("5 publiées · 2 en attente · 1 masquée");
  await expect(page.locator("#export-count-maries")).toHaveText("3 photos à exporter");
  await page.locator("#export-st-hidden").check();
  await expect(page.locator("#export-count-public")).toHaveText("8 photos à exporter");
  await expect(page.locator("#export-panel")).toContainText("tout administrateur y a accès");
  await expect(page.locator("#export-btn-public")).toHaveText("Exporter");
  // Back to the queue: the tab bar works as before.
  await page.locator("[data-filter=pending]").click();
  await expect(page.locator("#photos-view")).toBeVisible();
  await expect(page.locator("#export-panel")).toBeHidden();
});

test("public export: one archive, stored JPEGs in chronological order, index.csv with exact SHA-256, 'Export complet'", async ({ page }, testInfo) => {
  await openExport(page, { photos: 4, pending: ["paused"], reported: [{ reports: [{ reason: "sexual" }] }] });
  const files = collect(page, testInfo);
  await page.locator("#export-btn-public").click();
  await expect(summary(page)).toHaveText("Export complet : 5 photos sur 5.", { timeout: 40000 });
  const [zip, ...rest] = await files();
  expect(rest).toEqual([]);
  expect(zip.name).toBe("mariage-public-lot-01.zip");
  const z = readZip(zip.path);
  expect(z.bad).toBeNull();
  expect(z.files.every((f) => f.method === 0)).toBe(true); // stored
  const jpgs = z.files.filter((f) => f.name.endsWith(".jpg"));
  expect(jpgs.length).toBe(5); // the hidden one is not included by default
  expect(jpgs.map((f) => f.name)).toEqual([...jpgs.map((f) => f.name)].sort());
  expect(jpgs[0].name).toMatch(/^0001_2026-10-31T\d{4}_[0-9a-f]{8}\.jpg$/);
  const original = createHash("sha256").update(readFileSync("fixtures/photo_01.jpg")).digest("hex");
  const rows = csvRows(z.files.find((f) => f.name === "index.csv").text);
  expect(rows[0]).toEqual(["fichier", "identifiant", "date_envoi", "audience", "statut", "raison_attente", "taille_octets", "sha256"]);
  expect(rows.length).toBe(6);
  for (const row of rows.slice(1)) {
    const f = jpgs.find((x) => x.name === row[0]);
    expect(f.sha256).toBe(row[7]);
    expect(row[7]).toBe(original);
    expect(Number(row[6])).toBe(f.size);
    expect(row[3]).toBe("public");
  }
  expect(rows.slice(1).map((r) => r[4]).sort()).toEqual(["pending_review", "published", "published", "published", "published"]);
  expect(rows.find((r) => r[4] === "pending_review")[5]).toBe("paused");
});

test("private folder: its own archive names, audience 'maries', hidden photos only when ticked", async ({ page }, testInfo) => {
  await openExport(page, { photos: 2, mariesPhotos: 3 });
  const files = collect(page, testInfo);
  await page.locator("#export-btn-maries").click();
  await expect(summary(page)).toHaveText("Export complet : 3 photos sur 3.", { timeout: 40000 });
  const [zip] = await files();
  expect(zip.name).toBe("mariage-maries-lot-01.zip");
  const z = readZip(zip.path);
  expect(z.files.filter((f) => f.name.endsWith(".jpg")).length).toBe(3);
  expect(csvRows(z.files.find((f) => f.name === "index.csv").text).slice(1).every((r) => r[3] === "maries")).toBe(true);
});

test("lots: split at the first of the two thresholds (count, then bytes), numbered lot-01, lot-02…", async ({ page }, testInfo) => {
  await page.addInitScript(() => { globalThis.__exportOptions = { limits: { maxPhotos: 3, maxBytes: 1e12 }, delays: [10, 10] }; });
  await openExport(page, { photos: 8 });
  const files = collect(page, testInfo);
  await page.locator("#export-btn-public").click();
  await expect(summary(page)).toHaveText("Export complet : 8 photos sur 8.", { timeout: 60000 });
  const got = await files();
  expect(got.map((g) => g.name)).toEqual(["mariage-public-lot-01.zip", "mariage-public-lot-02.zip", "mariage-public-lot-03.zip"]);
  const counts = got.map((g) => readZip(g.path).files.filter((f) => f.name.endsWith(".jpg")).length);
  expect(counts).toEqual([3, 3, 2]);
  // numbering continues across the lots
  expect(readZip(got[1].path).files[0].name).toMatch(/^0004_/);
  await expect(page.locator("#export-lots")).toContainText("3 archives téléchargées");
});

test("lots by size: ~4 MB photos with a 5 MB limit give one photo or two per archive", async ({ page }, testInfo) => {
  await page.addInitScript(() => { globalThis.__exportOptions = { limits: { maxPhotos: 100, maxBytes: 5 * 1024 * 1024 }, delays: [10, 10] }; });
  await openExport(page, { photos: 4 });
  const files = collect(page, testInfo);
  await page.locator("#export-btn-public").click();
  await expect(summary(page)).toHaveText("Export complet : 4 photos sur 4.", { timeout: 60000 });
  const got = await files();
  expect(got.length).toBe(2); // 4.19 MB < 5 MB < 8.4 MB: each lot closes after two photos
  expect(got.map((g) => readZip(g.path).files.filter((f) => f.name.endsWith(".jpg")).length)).toEqual([2, 2]);
});

test("progress reads 'Lot 2 sur 3 : 1 sur 3', one photo at a time", async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.__exportOptions = { limits: { maxPhotos: 3, maxBytes: 1e12 }, delays: [10, 10] };
    // History of every text the progress label showed (polling could miss a short-lived state).
    addEventListener("DOMContentLoaded", () =>
      new MutationObserver(() => (globalThis.__labels ||= []).push(document.getElementById("export-label")?.textContent)).observe(document.body, { subtree: true, childList: true, characterData: true }),
    );
  });
  await openExport(page, { photos: 8 });
  let inFlight = 0, maxInFlight = 0;
  await page.route(/mock-id=/, async (route) => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 100));
    await route.continue();
    inFlight--;
  });
  await page.locator("#export-btn-public").click();
  await expect(page.locator("#export-cancel")).toBeVisible();
  await expect(summary(page)).toHaveText("Export complet : 8 photos sur 8.", { timeout: 60000 });
  const labels = await page.evaluate(() => globalThis.__labels);
  for (const wanted of ["Lot 1 sur 3 : 0 sur 3", "Lot 2 sur 3 : 1 sur 3", "Lot 3 sur 3 : 2 sur 2"]) expect(labels).toContain(wanted);
  expect(maxInFlight).toBe(1);
});

test("cancel: stops, saves the lot in progress with the photos already read, reports an interrupted export", async ({ page }, testInfo) => {
  await openExport(page, { photos: 6 });
  await page.route(/mock-id=/, async (route) => { await new Promise((r) => setTimeout(r, 400)); await route.continue(); });
  const files = collect(page, testInfo);
  await page.locator("#export-btn-public").click();
  await expect(page.locator("#export-label")).toHaveText(/: [1-9] sur 6/, { timeout: 20000 });
  await page.locator("#export-cancel").click();
  await expect(summary(page)).toContainText("Export interrompu", { timeout: 20000 });
  const [zip] = await files();
  const n = readZip(zip.path).files.filter((f) => f.name.endsWith(".jpg")).length;
  expect(n).toBeGreaterThanOrEqual(1);
  expect(n).toBeLessThan(6);
  await expect(summary(page)).toHaveText(new RegExp(`Export interrompu : ${n} photos? sur 6`));
  await expect(page.locator("#export-btn-public")).toBeEnabled();
});

test("transient network error: 3 attempts, the photo is exported without any failure", async ({ page }, testInfo) => {
  await page.addInitScript(() => { globalThis.__exportOptions = { delays: [10, 10] }; });
  await openExport(page, { photos: 3 });
  const bad = "00000001-0000-4000-8000-000000000000";
  let tries = 0;
  await page.route(new RegExp(`mock-id=${bad}`), async (route) => (++tries <= 2 ? route.abort("connectionreset") : route.continue()));
  const files = collect(page, testInfo);
  await page.locator("#export-btn-public").click();
  await expect(summary(page)).toHaveText("Export complet : 3 photos sur 3.", { timeout: 40000 });
  expect(tries).toBe(3);
  expect((await files()).length).toBe(1);
});

test("partial failure: the lot is not blocked, the report lists the photo, 'Réessayer les échecs' completes the export", async ({ page }, testInfo) => {
  await page.addInitScript(() => { globalThis.__exportOptions = { delays: [10, 10] }; });
  await openExport(page, { photos: 4 });
  const bad = "00000002-0000-4000-8000-000000000000";
  let broken = true;
  await page.route(new RegExp(`mock-id=${bad}`), (route) => (broken ? route.fulfill({ status: 404, body: "no" }) : route.continue()));
  const files = collect(page, testInfo);
  await page.locator("#export-btn-public").click();
  await expect(summary(page)).toHaveText("Export incomplet : 3 photos sur 4.", { timeout: 40000 });
  await expect(page.locator("#export-failures")).toContainText("Manquante : 00000002 (fichier introuvable)");
  await expect(page.locator("#export-retry")).toHaveText("Réessayer les échecs (1)");
  let got = await files();
  expect(got.map((g) => g.name)).toEqual(["mariage-public-lot-01.zip"]);
  expect(readZip(got[0].path).files.filter((f) => f.name.endsWith(".jpg")).length).toBe(3);
  broken = false;
  await page.locator("#export-retry").click();
  await expect(summary(page)).toHaveText("Export complet : 4 photos sur 4.", { timeout: 40000 });
  got = await files();
  expect(got.map((g) => g.name)).toEqual(["mariage-public-lot-01.zip", "mariage-public-lot-02.zip"]);
  const second = readZip(got[1].path).files;
  expect(second.filter((f) => f.name.endsWith(".jpg")).map((f) => f.name)[0]).toMatch(/^0002_/); // keeps its original chronological number (2nd oldest of the 4)
  await expect(page.locator("#export-retry")).toBeHidden();
});

test("integrity check lists the differences when the album changes during the export", async ({ page }) => {
  await page.addInitScript(() => { globalThis.__exportOptions = { delays: [10, 10] }; });
  await openExport(page, { photos: 3 });
  let added = false;
  await page.route(/mock-id=/, async (route) => {
    if (!added) {
      added = true;
      await page.evaluate(() => { window.mock.addPending("paused"); }); // a new pending photo arrives meanwhile
    }
    await route.continue();
  });
  await page.locator("#export-btn-public").click();
  await expect(summary(page)).toHaveText("Export incomplet : 3 photos sur 4.", { timeout: 40000 });
  await expect(page.locator("#export-failures")).toContainText("ajoutée ou modifiée pendant l’export");
});

test("the 30 s refresh does not run while exporting (no extra list request, export unaffected)", async ({ page }) => {
  await page.clock.install();
  await openExport(page, { photos: 3 });
  await page.route(/mock-id=/, async (route) => { await new Promise((r) => setTimeout(r, 300)); await route.continue(); });
  await page.locator("#export-btn-public").click();
  await expect(page.locator("#export-progress-panel")).toBeVisible();
  const calls = () => page.evaluate(() => window.mock.calls.filter((c) => c[0] === "admin_status").length);
  const before = await calls();
  await page.clock.runFor(95000);
  expect(await calls()).toBe(before);
  await expect(page.locator("#export-progress-panel")).toBeVisible();
});

test("desktop: no phone warning; phone: warning shown but not blocking", async ({ page, isMobile }) => {
  await openExport(page, { photos: 2 });
  const warning = page.locator("#export-mobile-warning");
  if (isMobile) {
    await expect(warning).toBeVisible();
    await expect(warning).toContainText("depuis un ordinateur");
    await expect(page.locator("#export-btn-public")).toBeEnabled();
  } else await expect(warning).toBeHidden();
});

test("non-administrator: the export tab is never reachable (access refused as for the rest of the dashboard)", async ({ page }) => {
  await installMock(page, { admin: true, nonAdmin: true });
  await page.goto("/admin.html");
  await expect(page.locator("#dashboard")).toBeHidden();
  await expect(page.locator("#login")).toBeVisible();
});

test("accessibility: export panel idle, running and with a report (axe-core)", async ({ page }) => {
  await page.addInitScript(() => { globalThis.__exportOptions = { delays: [10, 10] }; });
  await openExport(page, { photos: 3, mariesPhotos: 1 });
  const scan = async () => expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await scan();
  await page.route(/mock-id=/, async (route) => { await new Promise((r) => setTimeout(r, 300)); await route.continue(); });
  await page.locator("#export-btn-public").click();
  await expect(page.locator("#export-progress-panel")).toBeVisible();
  await scan();
  await expect(summary(page)).toHaveText("Export complet : 3 photos sur 3.", { timeout: 40000 });
  await scan();
});
