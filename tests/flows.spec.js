import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installMock } from "./mock.js";
const fixture = (name) => `fixtures/${name}`;
async function upload(page, names) {
  await page.locator("#files").setInputFiles(names.map(fixture));
  await expect(page.locator("#send")).toBeEnabled();
  await page.locator("#send").click();
  await expect(page.locator("#upload-status")).toContainText("en échec", {
    timeout: 30000,
  });
}
test("fallback, 360/tablet/desktop, semantics and no indexation", async ({
  page,
}) => {
  await page.goto("/");
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await expect(page.locator(".hero-cta")).toBeInViewport();
    await page.screenshot({
      path: `test-results/home-${width}.png`,
      fullPage: true,
    });
  }
  await expect(page.locator("meta[name=robots]")).toHaveAttribute(
    "content",
    "noindex,nofollow",
  );
  expect(await page.locator("img:visible").count()).toBe(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("link", { name: "Partager", exact: true }).click();
  await expect(page.locator("#send")).toBeDisabled();
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: `test-results/share-${width}.png`,
      fullPage: true,
    });
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test("QR persists and public client never inherits admin auth", async ({
  page,
}) => {
  await installMock(page, { secret: "wedding" });
  await page.goto("/?k=wedding");
  await page.getByRole("link", { name: "Partager", exact: true }).click();
  expect(page.url()).toContain("?k=wedding#partager");
  expect(await page.evaluate(() => localStorage.getItem("wk"))).toBe("wedding");
  expect(
    await page.evaluate(
      () => mock.calls.find((c) => c[0] === "client")[1].persistSession,
    ),
  ).toBe(false);
  await page.goto("/#partager");
  await expect(page.locator("#share-view")).toBeVisible();
});
test("public JPEG PNG uploads, exact duplicate, similar photos and compressed dimensions", async ({
  page,
}) => {
  await installMock(page);
  await page.goto("/#partager");
  await upload(page, [
    "photo_01.jpg",
    "photo_02.jpg",
    "photo_03.jpg",
    "photo_png.png",
    "photo_01_copie_exacte.jpg",
    "rafale_a.jpg",
    "rafale_b.jpg",
  ]);
  await expect(page.locator("#upload-status")).toContainText("6 ajoutée(s)");
  await expect(page.locator("#upload-status")).toContainText("1 doublon(s)");
  const data = await page.evaluate(() => ({
    records: mock.records.length,
    objects: [...mock.objects],
    calls: mock.calls,
  }));
  expect(data.records).toBe(6);
  expect(data.objects).toHaveLength(12);
  for (const [path, obj] of data.objects)
    expect(Math.max(obj.width, obj.height)).toBe(
      path.includes("thumbs") ? 400 : 1600,
    );
  expect(data.calls.filter((c) => c[0] === "model-load")).toHaveLength(1);
  const uploadCalls = data.calls.filter((c) => c[0] === "upload");
  expect(uploadCalls[0][1]).toContain("/thumbs/");
  expect(
    uploadCalls.every(
      (c) => c[2].type === "image/jpeg" && c[2].opts.upsert === false,
    ),
  ).toBeTruthy();
});
test("private upload skips NSFW and is absent from guest gallery", async ({
  page,
}) => {
  await installMock(page, { model: "unavailable" });
  await page.goto("/#partager");
  await page.locator("[value=maries]").check();
  await upload(page, ["portrait_exif6.jpg"]);
  await expect(page.locator("#upload-status")).toContainText(
    "1 envoyée(s) aux mariés",
  );
  const info = await page.evaluate(() => ({
    models: mock.calls.filter((c) => c[0] === "model-load").length,
    objects: [...mock.objects],
    registration: mock.calls.find((c) => c[0] === "register_photo")[1],
  }));
  expect(info.models).toBe(0);
  expect(info.registration.p_nsfw).toBe("skipped");
  expect(info.objects[1][1].height).toBeGreaterThan(info.objects[1][1].width);
  await page.getByRole("link", { name: "Accueil / Galerie" }).click();
  await expect(page.locator(".photo-card")).toHaveCount(0);
});
for (const [model, expected] of [
  ["suspect", "pending_review"],
  ["unavailable", "pending_review"],
  ["sexy", "published"],
])
  test(`NSFW ${model} -> ${expected}`, async ({ page }) => {
    await installMock(page, { model });
    await page.goto("/#partager");
    await upload(page, ["minuscule_1x1.png"]);
    expect(await page.evaluate(() => mock.records[0].status)).toBe(expected);
  });
test("network retry uses fresh UUID and never finalizes incomplete upload", async ({
  page,
}) => {
  await installMock(page, { failures: 1 });
  await page.goto("/#partager");
  await upload(page, ["photo_01.jpg"]);
  const calls = await page.evaluate(() => mock.calls);
  expect(calls.filter((c) => c[0] === "upload")).toHaveLength(4);
  expect(calls.filter((c) => c[0] === "register_photo")).toHaveLength(1);
  const thumbs = calls.filter(
    (c) => c[0] === "upload" && c[1].includes("/thumbs/"),
  );
  expect(thumbs[0][1]).not.toBe(thumbs[1][1]);
});
test("failure after 3 attempts is retryable, cancellation stops after current photo", async ({
  page,
}) => {
  await installMock(page, { failures: 3, uploadDelay: 150 });
  await page.goto("/#partager");
  await upload(page, ["photo_01.jpg"]);
  await expect(page.locator("#upload-status")).toContainText("1 en échec");
  expect(await page.evaluate(() => mock.records.length)).toBe(0);
  await page.locator("#retry").click();
  await expect(page.locator("#upload-status")).toContainText("1 ajoutée(s)");
  await page
    .locator("#files")
    .setInputFiles([fixture("photo_02.jpg"), fixture("photo_03.jpg")]);
  await expect(page.locator("#send")).toBeEnabled();
  await page.locator("#send").click();
  await page.locator("#cancel-upload").click();
  await expect(page.locator("#upload-status")).toContainText("Envoi arrêté");
  expect(await page.evaluate(() => mock.records.length)).toBe(2);
});
test("invalid file does not interrupt following valid image", async ({
  page,
}) => {
  await installMock(page);
  await page.goto("/#partager");
  await upload(page, ["pas_une_image.jpg", "minuscule_1x1.png"]);
  await expect(page.locator("#upload-status")).toContainText("1 ajoutée(s)");
  await expect(page.locator("#upload-status")).toContainText("1 en échec");
});
test("200 photos: pagination, refresh removal and new insertion, lightbox focus and signed download", async ({
  page,
}) => {
  await installMock(page, { photos: 200 });
  await page.goto("/");
  await expect(page.locator(".photo-card")).toHaveCount(48);
  await page.locator("#more").click();
  await expect(page.locator(".photo-card")).toHaveCount(96);
  await page.evaluate(() => {
    mock.records[70].status = "hidden";
    mock.records.unshift({
      ...mock.records[0],
      id: crypto.randomUUID(),
      published_at: new Date(Date.UTC(2026, 10, 1)).toISOString(),
    });
  });
  await page.locator("#refresh").click();
  await expect
    .poll(() =>
      page.evaluate(
        () => mock.calls.filter((c) => c[0] === "gallery_page").length,
      ),
    )
    .toBe(4);
  const ids = await page
    .locator(".photo-card")
    .evaluateAll((nodes) => nodes.map((n) => n.dataset.photoId));
  expect(new Set(ids).size).toBe(96);
  await page.locator(".photo-card").first().click();
  await expect(page.locator("#full-photo")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#photo-position")).toHaveText("2 / 96");
  await page.route("**/fixtures/photo_01.jpg?download=1", (route) =>
    route.fulfill({
      body: "test-download",
      contentType: "image/jpeg",
      headers: {
        "Content-Disposition": 'attachment; filename="photo-mariage.jpg"',
      },
    }),
  );
  await page.locator("#download").click();
  expect(
    await page.evaluate(
      () => mock.calls.filter((c) => c[0] === "sign").at(-1)[3].download,
    ),
  ).toBe("photo-mariage.jpg");
  await page.keyboard.press("Escape");
  await expect(page.locator("#lightbox")).not.toBeVisible();
  await expect(page.locator(".photo-card").first()).toBeFocused();
  await page.locator("#more").click();
  await expect(page.locator(".photo-card")).toHaveCount(144);
  await page.locator("#more").click();
  await expect(page.locator(".photo-card")).toHaveCount(192);
  await page.locator("#more").click();
  await expect(page.locator(".photo-card")).toHaveCount(200);
});
test("report UI submits once and honors already-reported result", async ({
  page,
}) => {
  await installMock(page, { photos: 1 });
  await page.goto("/");
  await page.locator(".photo-card").click();
  await page.locator("#report-open").click();
  await page.getByRole("button", { name: "Signaler", exact: true }).click();
  await expect(page.locator("#gallery-status")).toContainText("Merci");
  await expect(page.locator(".photo-card")).toHaveCount(1);
  await page.locator(".photo-card").click();
  await page.locator("#report-open").click();
  await page.getByRole("button", { name: "Signaler", exact: true }).click();
  await expect(page.locator("#report-status")).toContainText("déjà signalé");
});
test("admin login, hide restore pause delete and logout", async ({ page }) => {
  await installMock(page, { photos: 2 });
  await page.goto("/admin.html");
  await page.locator("#email").fill("admin@example.test");
  await page.locator("#password").fill("example-only");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.locator("#dashboard")).toBeVisible();
  await page.getByRole("button", { name: "Récentes", exact: true }).click();
  await expect(page.locator(".admin-card")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Masquer", exact: true })
    .first()
    .click();
  await expect(page.locator(".admin-card h3").first()).toHaveText("Masquée");
  await page
    .getByRole("button", { name: "Restaurer", exact: true })
    .first()
    .click();
  await expect(page.locator(".admin-card h3").first()).toHaveText("Publiée");
  await page.locator("#pause").click();
  await expect(page.locator("#publication-state")).toContainText("suspendues");
  await page
    .getByRole("button", { name: "Supprimer", exact: true })
    .first()
    .click();
  await page.locator("#confirm-no").click();
  await expect(page.locator(".admin-card")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Supprimer", exact: true })
    .first()
    .click();
  await page.locator("#confirm-yes").click();
  await expect(page.locator(".admin-card")).toHaveCount(1);
  expect(
    await page.evaluate(() => mock.calls.some((c) => c[0] === "remove")),
  ).toBeTruthy();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: `test-results/admin-${width}.png`,
      fullPage: true,
    });
  }
  await page.locator("#logout").click();
  await expect(page.locator("#dashboard")).not.toBeVisible();
  await expect(page.locator(".admin-card")).toHaveCount(0);
});
test("authenticated non-admin is denied and reduced motion is respected", async ({
  page,
}) => {
  await installMock(page, { admin: true, nonAdmin: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/admin.html");
  await expect(page.locator("#admin-message")).toContainText("n’a pas accès");
  await expect(page.locator("#dashboard")).not.toBeVisible();
  await page.goto("/");
  expect(
    await page
      .locator("html")
      .evaluate((node) => getComputedStyle(node).scrollBehavior),
  ).toBe("auto");
});
test("real locally hosted model loads and classifies without CDN", async ({
  page,
  browserName,
}) => {
  test.setTimeout(60000);
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { load } = await import("/vendor/nsfwjs/nsfwjs.js");
    const model = await load("/vendor/nsfwjs/models/mobilenet_v2/");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 400;
    canvas.getContext("2d").fillRect(0, 0, 400, 400);
    const result = await model.classify(canvas);
    model.dispose();
    return result.map((p) => p.className).sort();
  });
  expect(result).toEqual(["Drawing", "Hentai", "Neutral", "Porn", "Sexy"]);
});
test("touch swipe, second distinct report and modal keyboard trap", async ({
  page,
}) => {
  await installMock(page, { photos: 2 });
  await page.goto("/");
  await page.locator(".photo-card").first().click();
  await expect(page.locator("#full-photo")).toBeVisible();
  await page.locator("#full-photo").evaluate((node) => {
    for (const [name, property, x] of [
      ["touchstart", "touches", 250],
      ["touchend", "changedTouches", 100],
    ]) {
      const event = new Event(name);
      Object.defineProperty(event, property, {
        value: [{ clientX: x, clientY: 150 }],
      });
      node.dispatchEvent(event);
    }
  });
  await expect(page.locator("#photo-position")).toHaveText("2 / 2");
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => document.activeElement.closest("dialog")?.id),
    ).toBe("lightbox");
  }
  await page.evaluate(() => {
    mock.records[1].reports = ["another-browser"];
    mock.records[1].report_count = 1;
  });
  await page.locator("#report-open").click();
  await page.getByRole("button", { name: "Signaler", exact: true }).click();
  await expect(page.locator(".photo-card")).toHaveCount(1);
});
test("blocked localStorage uses memory identity and selection accepts malicious filename as text", async ({
  page,
}) => {
  await installMock(page);
  await page.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("blocked");
      },
    }),
  );
  await page.goto("/#partager");
  await upload(page, ["photo_01.jpg"]);
  const id = await page.evaluate(
    () => mock.calls.find((c) => c[0] === "register_photo")[1].p_uploader,
  );
  expect(id).toMatch(/^[a-f0-9-]{36}$/);
  await page.locator("#files").setInputFiles({
    name: "<img src=x onerror=alert(1)>.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("invalid"),
  });
  await expect(page.locator("#selection")).toContainText(
    "<img src=x onerror=alert(1)>.jpg",
  );
  expect(await page.locator("#selection [onerror]").count()).toBe(0);
});
test("CSP headers and lazy NSFW loading on gallery", async ({ page }) => {
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  const response = await page.goto("/");
  expect(response.headers()["content-security-policy"]).toContain(
    "default-src 'self'",
  );
  expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  expect(requests.some((url) => url.includes("/nsfwjs/"))).toBe(false);
});

test("polling removes hidden photos and preserves lightbox focus after refresh", async ({
  page,
}) => {
  await installMock(page, { photos: 2 });
  await page.clock.install();
  await page.goto("/");
  await page.locator(".photo-card").first().click();
  await expect(page.locator("#full-photo")).toBeVisible();
  await page.clock.fastForward(60001);
  await expect
    .poll(() =>
      page.evaluate(
        () => mock.calls.filter((call) => call[0] === "gallery_page").length,
      ),
    )
    .toBe(2);
  await page.keyboard.press("Escape");
  await expect(page.locator(".photo-card").first()).toBeFocused();
  await page.evaluate(() => (mock.records[0].status = "hidden"));
  await page.clock.fastForward(60001);
  await expect(page.locator(".photo-card")).toHaveCount(1);
});
