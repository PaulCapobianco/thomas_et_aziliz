import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installMock } from "./mock.js";
const emptyConfig = (page) =>
  page.route("**/config.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "export const NAMES='';export const DATE_TXT='31 octobre 2026';export const SUPABASE_URL='';export const SUPABASE_KEY='';export const BUCKET='photos';export const SECRET='';export const LOCATION='';export const COUPLE_PHOTO='';export const NSFW_ENABLED=true;",
    }),
  );
const fixture = (name) => `fixtures/${name}`;
// The final message (success, pending or error) replaces the progress block.
const settled = (page, timeout = 30000) =>
  expect(page.locator("#upload-message")).toHaveAttribute(
    "data-kind",
    /success|pending|error/,
    { timeout },
  );
async function upload(page, names) {
  await page.locator("#files").setInputFiles(names.map(fixture));
  await expect(page.locator("#send")).toBeEnabled();
  await page.locator("#send").click();
  await settled(page, 30000);
}
test("fallback, 360/tablet/desktop, semantics and no indexation", async ({
  page,
}) => {
  // The committed config.js now points at the real project; this test is about the unconfigured fallback.
  await emptyConfig(page);
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
  await expect(page.locator("#gallery img")).toHaveCount(0);
  await expect(page.locator(".polaroid img")).toHaveCount(7);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("link", { name: "Partager des photos", exact: true }).click();
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
  await page.getByRole("link", { name: "Partager des photos", exact: true }).click();
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
  await expect(page.locator("#upload-status")).toContainText("6 photos ajoutées à la galerie");
  await expect(page.locator("#upload-status")).toContainText("1 doublon ignoré");
  const data = await page.evaluate(() => ({
    records: mock.records.length,
    objects: [...mock.objects],
    calls: mock.calls,
  }));
  expect(data.records).toBe(6);
  expect(data.objects).toHaveLength(12);
  for (const [path, obj] of data.objects)
    expect(Math.max(obj.width, obj.height)).toBe(
      path.includes("thumbs") ? 800 : 3000,
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
    "1 photo envoyée aux mariés",
  );
  const info = await page.evaluate(() => ({
    models: mock.calls.filter((c) => c[0] === "model-load").length,
    objects: [...mock.objects],
    registration: mock.calls.find((c) => c[0] === "register_photo")[1],
  }));
  expect(info.models).toBe(0);
  expect(info.registration.p_nsfw).toBe("skipped");
  expect(info.objects[1][1].height).toBeGreaterThan(info.objects[1][1].width);
  await page.getByRole("link", { name: "Accueil", exact: true }).click();
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
  await expect(page.locator("#upload-status")).toContainText("1 photo n’a pas pu être envoyée");
  expect(await page.evaluate(() => mock.records.length)).toBe(0);
  await page.locator("#message-retry").click();
  await expect(page.locator("#upload-status")).toContainText("1 photo ajoutée à la galerie");
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
  await expect(page.locator("#upload-status")).toContainText("1 photo ajoutée à la galerie");
  await expect(page.locator("#upload-status")).toContainText("1 photo n’a pas pu être envoyée");
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

test("retry respects a changed private destination after a public upload failure", async ({
  page,
}) => {
  await installMock(page, { failures: 3 });
  await page.goto("/#partager");
  await upload(page, ["minuscule_1x1.png"]);
  await expect(page.locator("#upload-status")).toContainText("1 photo n’a pas pu être envoyée");
  await page.locator("[value=maries]").check();
  await page.locator("#message-retry").click();
  await expect(page.locator("#upload-status")).toContainText(
    "1 photo envoyée aux mariés",
  );
  expect(
    await page.evaluate(() => mock.records.map((row) => row.audience)),
  ).toEqual(["maries"]);
  await page.getByRole("link", { name: "Accueil", exact: true }).click();
  await expect(page.locator(".photo-card")).toHaveCount(0);
});

test("admin delete reports a Storage cleanup that silently removed nothing", async ({
  page,
}) => {
  await installMock(page, { photos: 1, removeNothing: true });
  await page.goto("/admin.html");
  await page.locator("#email").fill("admin@example.test");
  await page.locator("#password").fill("example-only");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.getByRole("button", { name: "Récentes", exact: true }).click();
  await page.getByRole("button", { name: "Supprimer", exact: true }).click();
  await page.locator("#confirm-yes").click();
  await expect(page.locator("#admin-message")).toContainText(
    "n’ont pas pu être effacés",
  );
});

test.describe("add-photos action", () => {
  test.use({ viewport: { width: 375, height: 667 } });
  test("primary button is large, sage and visible without scrolling on 375x667", async ({
    page,
  }) => {
    await installMock(page);
    await page.goto("/");
    const cta = page.locator(".hero-cta");
    await expect(cta).toBeInViewport({ ratio: 1 });
    await expect(cta).toHaveText(/PARTAGER MES PHOTOS/);
    const box = await cta.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(56);
    expect(box.width).toBeGreaterThanOrEqual(375 - 2 * 32);
    expect(
      await cta.evaluate((node) => getComputedStyle(node).backgroundColor),
    ).toBe("rgb(88, 101, 75)");
  });

  test("floating button stays reachable while scrolling the gallery, and is absent on the share page", async ({
    page,
  }) => {
    await installMock(page, { photos: 60 });
    await page.goto("/");
    const fab = page.locator("#fab-bar .fab");
    await expect(fab).toBeHidden(); // the hero button is on screen
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(fab).toBeInViewport({ ratio: 1 });
    expect((await fab.boundingBox()).height).toBeGreaterThanOrEqual(56);
    // The footer must stay readable above the bar.
    await expect(page.locator(".site-footer")).toBeVisible();
    await fab.click({ trial: true });
    await page.goto("/#partager");
    await expect(page.locator("#fab-bar")).toBeHidden();
  });

  test("one tap opens the chooser; select, send and finish with explicit states", async ({
    page,
  }) => {
    await installMock(page);
    await page.goto("/");
    const chooser = page.waitForEvent("filechooser");
    await page.locator(".hero-cta").click();
    await (await chooser).setFiles([fixture("photo_01.jpg"), fixture("photo_02.jpg")]);
    await expect(page.locator("#share-view")).toBeVisible();
    await expect(page.locator("#upload-status")).toContainText(
      "2 photo(s) prête(s)",
    );
    await expect(page.locator("#send-destination")).toContainText(
      "galerie commune",
    );
    await expect(page.locator("#send")).toHaveText(/Envoyer 2 photo\(s\)/);
    await page.locator("[name=audience][value=maries]").check();
    await expect(page.locator("#send-destination")).toContainText("mariés");
    await page.locator("[name=audience][value=public]").check();
    await page.evaluate(() => {
      window.__progressSeen = false;
      new MutationObserver(() => {
        if (!document.getElementById("progress-panel").hidden) window.__progressSeen = true;
      }).observe(document.getElementById("progress-panel"), { attributes: true });
    });
    await page.locator("#send").click();
    await settled(page);
    expect(await page.evaluate(() => window.__progressSeen)).toBeTruthy();
    await expect(page.locator("#progress-panel")).toBeHidden();
    await expect(page.locator("#upload-status")).toContainText(
      "2 photos ajoutées à la galerie",
    );
    await expect(page.locator("#selection")).toContainText("Ajoutée à la galerie");
  });

  test("a failed upload says so and offers a retry", async ({ page }) => {
    await installMock(page, { failures: 99 });
    await page.goto("/#partager");
    await page.locator("#files").setInputFiles([fixture("photo_01.jpg")]);
    await expect(page.locator("#send")).toBeEnabled();
    await page.locator("#send").click();
    await settled(page);
    await expect(page.locator("#upload-status")).toContainText(
      "1 photo n’a pas pu être envoyée",
    );
    await expect(page.locator("#message-retry")).toBeVisible();
    await expect(page.locator("#selection")).toContainText("Échec");
  });

  test("an unconfigured site explains why nothing can be sent", async ({
    page,
  }) => {
    await emptyConfig(page);
    await page.goto("/#partager");
    await expect(page.locator("#upload-status")).toContainText(
      "pas encore ouverts",
    );
    await expect(page.locator("#files")).toBeDisabled();
    await expect(page.locator("#fab-bar")).toBeHidden();
  });
});

test("a refresh reuses the signed thumbnail URLs already on screen (no re-download of the grid)", async ({
  page,
}) => {
  await installMock(page, { photos: 6 });
  await page.goto("/");
  await expect(page.locator("#gallery .photo-card")).toHaveCount(6);
  const signs = () =>
    page.evaluate(() => mock.calls.filter((c) => c[0] === "signs").length);
  const before = await signs();
  await page.locator("#refresh").click();
  await expect(page.locator("#refresh")).toBeEnabled();
  await page.locator("#refresh").click();
  await expect(page.locator("#refresh")).toBeEnabled();
  expect(await signs()).toBe(before);
});

test("lightbox shows the thumbnail instantly then the full-resolution file", async ({
  page,
}) => {
  await installMock(page, { photos: 3 });
  await page.goto("/");
  await page.locator("#gallery .photo-card").first().click();
  await expect(page.locator("#full-photo")).toBeVisible();
  await expect
    .poll(() => page.locator("#full-photo").evaluate((i) => i.complete && i.naturalWidth > 0))
    .toBeTruthy();
  await expect(page.locator("#lightbox-status")).toHaveText("");
});

test.describe("gallery never loses photos around a publication", () => {
  const sendFiles = async (page, files, audience = "public") => {
    // Navigate inside the page (no reload): the mock keeps its state only while the document lives.
    if (page.url() === "about:blank") await page.goto("/#partager");
    else await page.getByRole("link", { name: "Partager des photos", exact: true }).click();
    await page.locator(`[name=audience][value=${audience}]`).check();
    await page.locator("#files").setInputFiles(files.map(fixture));
    await page.locator("#send").click();
    await settled(page, 40000);
  };
  const cards = (page) => page.locator("#gallery .photo-card");
  const allImagesLoaded = (page) =>
    page
      .locator("#gallery .photo-card img")
      .evaluateAll((imgs) => imgs.every((i) => i.complete && i.naturalWidth > 0));

  test("2 photos, publish a 3rd: 3 stay visible; a failing refresh keeps them; duplicate and private sends change nothing", async ({
    page,
  }) => {
    await installMock(page, { photos: 2 });
    await page.goto("/");
    await expect(cards(page)).toHaveCount(2);
    await sendFiles(page, ["photo_03.jpg"]);
    await expect(page.locator("#upload-status")).toContainText("1 photo ajoutée à la galerie");
    await page.getByRole("link", { name: "Accueil", exact: true }).click();
    await expect(cards(page)).toHaveCount(3);
    await expect.poll(() => allImagesLoaded(page)).toBeTruthy();
    // The new photo opens in the lightbox with its full-resolution file.
    await cards(page).first().click();
    await expect(page.locator("#lightbox-status")).toHaveText("");
    await expect(page.locator("#full-photo")).toBeVisible();
    await page.locator("#close-lightbox").click();
    // A refresh that fails keeps the photos on screen and says so.
    await page.evaluate(() => (mock.galleryDown = true));
    await page.locator("#refresh").click();
    await expect(page.locator("#gallery-status")).toContainText("Impossible");
    await expect(cards(page)).toHaveCount(3);
    await page.evaluate(() => (mock.galleryDown = false));
    await page.locator("#refresh").click();
    await expect(page.locator("#gallery-status")).toHaveText("");
    await expect(cards(page)).toHaveCount(3);
    // Same file again: ignored. Private send: not in the shared gallery.
    await sendFiles(page, ["photo_03.jpg"]);
    await expect(page.locator("#upload-status")).toContainText("1 doublon ignoré");
    await sendFiles(page, ["photo_02.jpg"], "maries");
    await expect(page.locator("#upload-status")).toContainText("aux mariés");
    await page.getByRole("link", { name: "Accueil", exact: true }).click();
    await expect(cards(page)).toHaveCount(3);
  });

  test("several photos at once, and a photo kept for review does not hide the others", async ({
    page,
  }) => {
    await installMock(page, { photos: 2 });
    await page.goto("/");
    await expect(cards(page)).toHaveCount(2);
    await sendFiles(page, ["photo_01.jpg", "photo_02.jpg", "photo_03.jpg"]);
    await page.getByRole("link", { name: "Accueil", exact: true }).click();
    await expect(cards(page)).toHaveCount(5);
    await page.evaluate(() => (mock.records[0].status = "pending_review"));
    await page.locator("#refresh").click();
    await expect(cards(page)).toHaveCount(4);
  });

  test("a failed network during the upload does not blank the gallery", async ({
    page,
  }) => {
    await installMock(page, { photos: 2, failures: 99 });
    await page.goto("/");
    await expect(cards(page)).toHaveCount(2);
    await sendFiles(page, ["photo_01.jpg"]);
    await expect(page.locator("#message-retry")).toBeVisible();
    await page.getByRole("link", { name: "Accueil", exact: true }).click();
    await expect(cards(page)).toHaveCount(2);
    await expect.poll(() => allImagesLoaded(page)).toBeTruthy();
  });

  test("the album is never declared empty after a failed first load, and recovers by itself", async ({
    page,
  }) => {
    await installMock(page, { photos: 2, galleryDown: true });
    await page.goto("/");
    await expect(page.locator("#gallery-status")).toContainText("Impossible");
    await expect(page.locator("#gallery")).not.toContainText("encore vide");
    await expect(page.locator("#gallery")).toContainText("pas pu être chargés");
    await page.evaluate(() => (mock.galleryDown = false));
    await expect(cards(page)).toHaveCount(2, { timeout: 15000 });
    await expect(page.locator("#gallery-status")).toHaveText("");
  });

  test("a thumbnail that fails to load triggers fresh signatures and then displays", async ({
    page,
  }) => {
    await installMock(page, { photos: 3, badSignOnce: true });
    await page.goto("/");
    await expect(cards(page)).toHaveCount(3);
    await expect.poll(() => allImagesLoaded(page), { timeout: 15000 }).toBeTruthy();
    expect(
      await page.evaluate(() => mock.calls.filter((c) => c[0] === "signs").length),
    ).toBeGreaterThanOrEqual(2);
  });
});

test("gallery with a freshly published photo renders correctly at 390 and 1440 px", async ({
  page,
}) => {
  await installMock(page, { photos: 2 });
  await page.goto("/");
  await expect(page.locator("#gallery .photo-card")).toHaveCount(2);
  await page.getByRole("link", { name: "Partager des photos", exact: true }).click();
  await page.locator("#files").setInputFiles([fixture("photo_03.jpg")]);
  await page.locator("#send").click();
  await settled(page, 40000);
  await page.getByRole("link", { name: "Accueil", exact: true }).click();
  await expect(page.locator("#gallery .photo-card")).toHaveCount(3);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator("#gallery").scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    const boxes = await page
      .locator("#gallery .photo-card")
      .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect()).map((r) => [r.width, r.height]));
    expect(boxes).toHaveLength(3);
    expect(boxes.every(([w, h]) => w > 100 && h > 100)).toBeTruthy();
    expect(
      await page
        .locator("#gallery .photo-card img")
        .evaluateAll((imgs) => imgs.every((i) => i.complete && i.naturalWidth > 0)),
    ).toBeTruthy();
    await page.locator("#gallery").screenshot({ path: `test-results/gallery-after-publish-${width}.png` });
  }
});
