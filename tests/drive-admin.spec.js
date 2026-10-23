import { test, expect } from "@playwright/test";
import { installMock } from "./mock.js";

// Wraps the mock client AFTER installMock: only admin_drive_* are answered here, everything else stays the mock's.
async function withDrive(page, drive) {
  await installMock(page, { admin: true, photos: 3 });
  await page.addInitScript((drive) => {
    window.__driveCalls = [];
    const original = window.supabase.createClient;
    window.supabase.createClient = (...args) => {
      const client = original(...args);
      const rpc = client.rpc.bind(client);
      client.rpc = async (name, params) => {
        if (name === "admin_drive_status") {
          window.__driveCalls.push(name);
          return drive ? { data: drive, error: null } : { data: null, error: { code: "42883", message: "function admin_drive_status() does not exist" } };
        }
        if (name === "admin_drive_retry") { window.__driveCalls.push(name); return { data: { requeued: 1 }, error: null }; }
        return rpc(name, params);
      };
      return client;
    };
  }, drive);
  await page.goto("/admin.html");
  await expect(page.locator("#dashboard")).toBeVisible();
}
const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();

test("admin Drive line: counters, volume and last error are shown", async ({ page }) => {
  await withDrive(page, { transferred: 12, pending: 0, failed: 2, bytes: 7_200_000, last_error: "drive_503", oldest_waiting: ago(3) });
  const line = page.locator("#drive-summary");
  await expect(line).toBeVisible();
  await expect(line).toContainText("12 copiée(s), 0 en attente, 2 en échec, 7.2 Mo transférés");
  await expect(line).toContainText("dernière erreur : drive_503");
  await expect(line).not.toContainText("plus de 15 minutes");
  await expect(page.locator("#drive-retry")).toBeVisible();
  await expect(page.locator("#drive-retry")).toContainText("Relancer les échecs");
});

test("admin Drive line: a photo waiting more than 15 minutes raises a visible alert (cron stopped)", async ({ page }) => {
  await withDrive(page, { transferred: 4, pending: 3, failed: 0, bytes: 1_000_000, last_error: null, oldest_waiting: ago(40) });
  await expect(page.locator("#drive-summary")).toContainText("attendent depuis plus de 15 minutes, lancez la sauvegarde manuellement");
  await expect(page.locator("#drive-retry")).toBeVisible();
  await expect(page.locator("#drive-retry")).toContainText("Lancer la sauvegarde Drive maintenant");
});

test("admin Drive line: nothing waiting, no alert and no button", async ({ page }) => {
  await withDrive(page, { transferred: 9, pending: 0, failed: 0, bytes: 5_000_000, last_error: null, oldest_waiting: null });
  await expect(page.locator("#drive-summary")).toContainText("9 copiée(s), 0 en attente, 0 en échec");
  await expect(page.locator("#drive-summary")).not.toContainText("attention");
  await expect(page.locator("#drive-retry")).toBeHidden();
});

test("admin Drive line: hidden when migration 0005 is absent, the rest of the admin keeps working", async ({ page }) => {
  await withDrive(page, null);
  await expect(page.locator("#drive-summary")).toBeHidden();
  await expect(page.locator("#drive-retry")).toBeHidden();
  await expect(page.locator("#stats")).toContainText("Publiées");
});

test("admin Drive button: requeues failures then triggers the sync endpoint with the admin session", async ({ page }) => {
  let request;
  await page.route("**/api/drive-sync", (route) => { request = route.request(); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, claimed: 1, transferred: 1, failed: 0, error: null }) }); });
  await withDrive(page, { transferred: 1, pending: 0, failed: 1, bytes: 1000, last_error: "drive_503", oldest_waiting: ago(5) });
  await page.locator("#drive-retry").click();
  await expect(page.locator("#drive-result")).toContainText("1 photo(s) copiée(s), 0 échec(s)");
  await page.waitForTimeout(500); // the counters refresh must not erase the result
  await expect(page.locator("#drive-result")).toContainText("1 photo(s) copiée(s)");
  expect(request.method()).toBe("POST");
  expect(request.headers().authorization).toMatch(/^Bearer /);
  expect(await page.evaluate(() => window.__driveCalls.filter((n) => n === "admin_drive_retry").length)).toBe(1);
});

test("admin Drive button: endpoint disabled or Drive down gives a calm message and nothing is lost", async ({ page }) => {
  await page.route("**/api/drive-sync", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "disabled" }) }));
  await withDrive(page, { transferred: 0, pending: 2, failed: 0, bytes: 0, last_error: null, oldest_waiting: ago(20) });
  await page.locator("#drive-retry").click();
  await expect(page.locator("#drive-result")).toContainText("Sauvegarde Drive indisponible (disabled)");
  await page.waitForTimeout(500);
  await expect(page.locator("#drive-result")).toContainText("Les photos restent conservées dans Supabase");
  await expect(page.locator("#drive-retry")).toBeEnabled();
});
