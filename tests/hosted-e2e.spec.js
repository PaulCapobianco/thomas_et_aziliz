// End-to-end send against the HOSTED Supabase project configured in config.js (real Storage, RPC, NSFWJS model).
// Writes one 2-file photo per project run into the real bucket. Opt-in only: HOSTED_E2E=1 npx playwright test tests/hosted-e2e.spec.js --workers=1
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { SUPABASE_URL, SUPABASE_KEY } from "../config.js";

test.skip(!process.env.HOSTED_E2E, "NON_TESTÉ: opt-in (HOSTED_E2E=1), écrit sur le projet hébergé");

test("real send from the unmodified site to the hosted project", async ({ page }, info) => {
  test.setTimeout(120000);
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const ids = async () => new Set(((await sb.rpc("gallery_page", { p_limit: 100 })).data ?? []).map((r) => r.id));
  const before = await ids();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => r.status() >= 400 && /supabase\.co/.test(r.url()) && errors.push(`${r.status()} ${r.url().slice(0, 90)}`));
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.locator(".hero-cta").click();
  const bytes = Buffer.concat([await readFile("fixtures/photo_03.jpg"), Buffer.from(`e2e:${info.project.name}:${Date.now()}`)]);
  await (await chooser).setFiles([{ name: "e2e.jpg", mimeType: "image/jpeg", buffer: bytes }]);
  await expect(page.locator("#upload-status")).toContainText("1 photo(s) prête(s)");
  await page.locator("#send").click();
  await expect(page.locator("#upload-message")).toHaveAttribute("data-kind", /success|pending|error/, { timeout: 90000 });
  const status = await page.locator("#upload-status").textContent();
  console.log(`[${info.project.name}] ${status}`);
  expect(status).toMatch(/Votre photo a bien été ajoutée à la galerie|1 photo reçue/);
  const after = [...(await ids())].filter((id) => !before.has(id));
  console.log(`[${info.project.name}] nouvelle(s) photo(s) publique(s): ${after.join(", ") || "(aucune: en attente)"}; erreurs réseau: ${errors.join(" | ") || "aucune"}`);
  if (/ajoutée à la galerie/.test(status)) {
    expect(after.length).toBe(1);
    await page.getByRole("link", { name: "Accueil", exact: true }).click();
    await page.locator("#refresh").click();
    await expect(page.locator(`[data-photo-id="${after[0]}"] img`)).toBeVisible({ timeout: 20000 });
  }
  expect(errors).toEqual([]);
});
