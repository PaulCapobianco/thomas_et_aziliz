export async function installMock(page, options = {}) {
  await page.route("**/config.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const NAMES=''; export const DATE_TXT='31 octobre 2026'; export const SUPABASE_URL='https://example.supabase.co'; export const SUPABASE_KEY='public-key'; export const BUCKET='photos'; export const SECRET=${JSON.stringify(options.secret || "")}; export const LOCATION=''; export const COUPLE_PHOTO=''; export const NSFW_ENABLED=true;`,
    }),
  );
  // Keep the injected fake from being overwritten by the actual UMD script.
  await page.route("**/vendor/supabase.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: "" }),
  );
  await page.addInitScript((options) => {
    const records = [],
      objects = new Map(),
      calls = [];
    let paused = Boolean(options.paused),
      logged = options.admin || false,
      failures = options.failures || 0;
    const pathFor = (id) => ({
      full_path: `public/full/${id}.jpg`,
      thumb_path: `public/thumbs/${id}.jpg`,
    });
    for (let i = 0; i < (options.photos || 0); i++) {
      const id = String(i).padStart(8, "0") + "-0000-4000-8000-000000000000";
      records.push({
        id,
        ...pathFor(id),
        published_at: new Date(
          Date.UTC(2026, 9, 31, 20, 0, 0) - i * 1000,
        ).toISOString(),
        created_at: new Date().toISOString(),
        audience: "public",
        status: "published",
        report_count: 0,
        report_reasons: [],
        reports: [],
      });
    }
    // Pending photos for the moderation queue: options.pending = ["nsfw", "paused", ...] (newest first by index).
    let pendingSeq = 0;
    const addPending = (reason = "paused", audience = "public") => {
      const n = ++pendingSeq;
      const id = `ffff${String(n).padStart(4, "0")}-0000-4000-8000-000000000000`;
      records.unshift({
        id,
        ...pathFor(id),
        published_at: null,
        // Later ones are newer: the queue sort (newest first) is then visible in the tests.
        created_at: new Date(Date.UTC(2026, 9, 31, 21, 0, 0) + n * 1000).toISOString(),
        audience,
        status: "pending_review",
        review_reason: reason,
        report_count: 0,
        report_reasons: [],
        reports: [],
      });
      return id;
    };
    (options.pending || []).forEach((reason) => addPending(reason));
    // Private photos ("Mariés uniquement") for the admin: options.maries = n.
    for (let i = 0; i < (options.maries || 0); i++) {
      const id = `dddd${String(i).padStart(4, "0")}-0000-4000-8000-000000000000`;
      records.push({
        id,
        full_path: `maries/full/${id}.jpg`,
        thumb_path: `maries/thumbs/${id}.jpg`,
        published_at: new Date(Date.UTC(2026, 9, 31, 19, 0, 0) - i * 1000).toISOString(),
        created_at: new Date(Date.UTC(2026, 9, 31, 19, 0, 0) - i * 1000).toISOString(),
        audience: "maries",
        status: "published",
        report_count: 0,
        report_reasons: [],
        reports: [],
      });
    }
    // Reported photos for the admin: options.reported = [{ reports: [{ reason, comment }], status? }]
    let reportedSeq = 0;
    const addReported = ({ reports = [{ reason: "sexual", comment: null }], status = "hidden" } = {}) => {
      const n = ++reportedSeq;
      const id = `eeee${String(n).padStart(4, "0")}-0000-4000-8000-000000000000`;
      records.unshift({
        id,
        ...pathFor(id),
        published_at: new Date(Date.UTC(2026, 9, 31, 20, 0, 0) - n * 1000).toISOString(),
        created_at: new Date(Date.UTC(2026, 9, 31, 20, 0, 0) - n * 1000).toISOString(),
        audience: "public",
        status,
        review_reason: status === "hidden" ? "reports" : null,
        report_count: 0,
        report_reasons: [],
        reports: reports.map((x, i) => ({
          at: new Date(Date.UTC(2026, 9, 31, 22, 0, 0) + (n * 10 + i) * 1000).toISOString(),
          reason: x.reason,
          comment: x.comment ?? null,
          reporter: `seed-${n}-${i}`,
          resolved: false,
          resolution: null,
        })),
      });
      return id;
    };
    (options.reported || []).forEach((spec) => addReported(spec));
    window.mock = {
      addPending,
      addReported,
      failStatusFor: new Set(),
      removeShortFor: new Set(), // ids whose Storage files "cannot be deleted" (Storage answers 200 with a short list)
      statusDelay: 0,
      records,
      objects,
      calls,
      galleryDown: Boolean(options.galleryDown),
      rateLimitReports: Boolean(options.rateLimitReports),
      galleryDelay: 0,
      badSignOnce: Boolean(options.badSignOnce),
      get paused() {
        return paused;
      },
      set failures(n) {
        failures = n;
      },
    };
    const ok = (data) => ({ data, error: null });
    const fail = (code = "42501") => ({
      data: null,
      error: { code, message: "denied" },
    });
    const url = (path = "") => {
      const index = Number.parseInt(path.split("/").at(-1), 10) || 0;
      const pathUrl = options.photoUrls?.[index % options.photoUrls.length] || "/fixtures/photo_01.jpg";
      return options.uniqueUrls ? `${pathUrl}?mock-photo=${index}` : pathUrl;
    };
    const callbacks = [];
    window.supabase = {
      createClient(_url, _key, settings) {
        calls.push(["client", settings.auth]);
        const admin = settings.auth.persistSession;
        const allowed = () => admin && logged && !options.nonAdmin;
        return {
          auth: {
            getSession: async () =>
              ok({ session: logged ? { user: { id: "admin" } } : null }),
            signInWithPassword: async () => {
              logged = true;
              return ok({});
            },
            signOut: async () => {
              logged = false;
              callbacks.forEach((cb) => cb("SIGNED_OUT"));
              return ok({});
            },
            onAuthStateChange: (cb) => {
              callbacks.push(cb);
              return { data: {} };
            },
          },
          rpc: async (name, p = {}) => {
            calls.push([name, p]);
            if (name.startsWith("admin_") && !allowed()) return fail();
            if (name === "gallery_page" && window.mock.galleryDown)
              return { data: null, error: { code: "500", message: "down" } };
            if (name === "gallery_page" && window.mock.galleryDelay)
              await new Promise((r) => setTimeout(r, window.mock.galleryDelay));
            if (name === "gallery_page")
              return ok(
                records
                  .filter(
                    (r) =>
                      r.audience === "public" &&
                      r.status === "published" &&
                      (!p.p_before_published ||
                        r.published_at < p.p_before_published ||
                        (r.published_at === p.p_before_published &&
                          r.id < p.p_before_id)),
                  )
                  .sort(
                    (a, b) =>
                      b.published_at.localeCompare(a.published_at) ||
                      b.id.localeCompare(a.id),
                  )
                  .slice(0, p.p_limit),
              );
            if (name === "check_duplicates")
              return ok(
                records
                  .filter(
                    (r) =>
                      r.audience === p.p_audience &&
                      r.status !== "deleted" &&
                      p.p_hashes.includes(r.hash),
                  )
                  .map((r) => r.hash),
              );
            if (name === "register_photo" && options.rateLimited)
              return ok({ result: "rate_limited" });
            if (name === "register_photo") {
              if (
                !objects.has(`${p.p_audience}/thumbs/${p.p_id}.jpg`) ||
                !objects.has(`${p.p_audience}/full/${p.p_id}.jpg`)
              )
                return fail("P0002");
              const pending =
                p.p_audience === "public" && (p.p_nsfw !== "clean" || paused);
              const status = pending ? "pending_review" : "published";
              records.unshift({
                id: p.p_id,
                audience: p.p_audience,
                status,
                hash: p.p_sha256,
                full_path: `${p.p_audience}/full/${p.p_id}.jpg`,
                thumb_path: `${p.p_audience}/thumbs/${p.p_id}.jpg`,
                published_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
                report_count: 0,
                reports: [],
                review_reason: pending
                  ? p.p_nsfw === "suspect"
                    ? "nsfw"
                    : p.p_nsfw === "unavailable"
                      ? "model_unavailable"
                      : "paused"
                  : null,
              });
              return ok({ result: status });
            }
            if (name === "report_photo") {
              const reasons = ["sexual", "violence", "privacy", "inappropriate", "other"];
              const bad = (message) => ({ data: null, error: { code: "22023", message } });
              if (!p.p_reason || !reasons.includes(p.p_reason)) return bad("invalid_reason");
              const comment = String(p.p_comment ?? "").trim();
              if (comment.length > 500) return bad("comment_too_long");
              if (p.p_reason === "other" && comment.length < 3) return bad("comment_required");
              const r = records.find(
                (r) =>
                  r.id === p.p_photo_id &&
                  r.audience === "public" &&
                  (r.status === "published" || (r.status === "hidden" && r.review_reason === "reports")),
              );
              if (!r) return ok({ result: "not_found" });
              const mine = r.reports.filter((x) => x.reporter === p.p_reporter);
              if (mine.some((x) => !x.resolved) || mine.length >= 3)
                return ok({ result: "already_reported" });
              if (window.mock.rateLimitReports) return ok({ result: "rate_limited" });
              // The FIRST valid report hides the photo (server side).
              r.reports.unshift({ at: new Date().toISOString(), reason: p.p_reason, comment: comment || null, reporter: p.p_reporter, resolved: false, resolution: null });
              const hidden = r.status === "published";
              if (hidden) {
                r.status = "hidden";
                r.review_reason = "reports";
              }
              return ok({ result: "reported", hidden });
            }
            if (name === "admin_status")
              return ok({
                paused,
                published: records.filter((r) => r.status === "published")
                  .length,
                reported: records.filter((r) => r.status !== "deleted" && r.reports.some((x) => !x.resolved)).length,
                pending: records.filter((r) => r.status === "pending_review")
                  .length,
                hidden: 0,
                maries: 0,
                storage_bytes: 123400,
                storage_objects: objects.size,
              });
            if (name === "admin_list_photos") {
              const open = (r) => r.reports.filter((x) => !x.resolved);
              return ok(
                records
                  .filter(
                    (r) =>
                      r.status !== "deleted" &&
                      (p.p_filter === "recent"
                        ? r.audience === "public"
                        : p.p_filter === "reported"
                          ? open(r).length > 0
                          : p.p_filter === "pending"
                            ? r.status === "pending_review"
                            : p.p_filter === "hidden"
                              ? r.status === "hidden"
                              : r.audience === "maries"),
                  )
                  .sort((a, b) =>
                    p.p_filter === "reported"
                      ? String(open(b)[0]?.at).localeCompare(String(open(a)[0]?.at))
                      : String(b.created_at).localeCompare(String(a.created_at)),
                  )
                  .slice(p.p_offset, p.p_offset + p.p_limit)
                  .map((r) => ({
                    ...r,
                    report_count: r.reports.length,
                    open_reports: open(r).length,
                    report_reasons: [...new Set(open(r).map((x) => x.reason))],
                    last_report_at: r.reports[0]?.at ?? null,
                    reports: r.reports.slice(0, 20).map(({ reporter, ...x }) => x),
                    last_decision: r.decision ?? null,
                  })),
              );
            }
            if (name === "admin_set_paused") {
              paused = p.p_paused;
              return ok({ paused });
            }
            if (name === "admin_set_status" && window.mock.statusDelay)
              await new Promise((r) => setTimeout(r, window.mock.statusDelay));
            if (name === "admin_set_status" && window.mock.failStatusFor.has(p.p_id))
              return { data: null, error: { code: "500", message: "boom" } };
            if (name === "admin_set_status") {
              const r = records.find((r) => r.id === p.p_id && r.status !== "deleted");
              if (!r) return ok({ result: "not_found" });
              const open = r.reports.filter((x) => !x.resolved).length;
              r.status = p.p_status;
              r.review_reason = p.p_status === "published" ? null : p.p_status === "hidden" ? "admin" : r.review_reason;
              // Reports are kept (a trace) and marked resolved; they never hide anything again.
              r.reports.forEach((x) => {
                if (!x.resolved) Object.assign(x, { resolved: true, resolution: { published: "restored", hidden: "kept_hidden", deleted: "deleted" }[p.p_status] });
              });
              r.decision = { action: p.p_status === "published" ? (open ? "restored" : "published") : p.p_status === "hidden" ? (open ? "kept_hidden" : "hidden") : "deleted", at: new Date().toISOString() };
              return ok({ result: p.p_status });
            }
            if (name === "admin_release_pending") {
              records
                .filter((r) => r.review_reason === p.p_reason)
                .forEach((r) => (r.status = "published"));
              return ok({ released: 1 });
            }
            return fail();
          },
          storage: {
            from: () => ({
              upload: async (path, blob, opts) => {
                calls.push([
                  "upload",
                  path,
                  { size: blob.size, type: blob.type, opts },
                ]);
                if (options.uploadDelay)
                  await new Promise((r) => setTimeout(r, options.uploadDelay));
                if (path.includes("/full/") && failures-- > 0)
                  return {
                    data: null,
                    error: { status: 503, message: "offline" },
                  };
                if (objects.has(path))
                  return { data: null, error: { status: 409 } };
                const bitmap = await createImageBitmap(blob);
                objects.set(path, {
                  size: blob.size,
                  width: bitmap.width,
                  height: bitmap.height,
                });
                bitmap.close();
                return ok({ path });
              },
              createSignedUrls: async (paths) => {
                calls.push(["signs", paths]);
                if (window.mock.badSignOnce) {
                  window.mock.badSignOnce = false;
                  return ok(paths.map((path) => ({ path, signedUrl: "/fixtures/absent-signature.jpg" })));
                }
                return ok(paths.map((path) => ({ path, signedUrl: url(path) })));
              },
              createSignedUrl: async (path, ttl, opts) => {
                calls.push(["sign", path, ttl, opts]);
                // Storage answers 400 for an object the guest may not read (private, hidden, reported).
                if (window.mock.signRefused) return { data: null, error: { status: 400, statusCode: "400", message: "Object not found" } };
                return opts?.download
                  ? ok({ signedUrl: "/fixtures/photo_01.jpg?download=1" })
                  : ok({ signedUrl: url(path) });
              },
              remove: async (paths) => {
                calls.push(["remove", paths]);
                // The real Storage API returns the objects it actually deleted.
                const short = [...window.mock.removeShortFor].some((id) => paths.some((p) => p.includes(id)));
                return ok(options.removeNothing || short ? [] : paths.map((name) => ({ name })));
              },
            }),
          },
        };
      },
    };
    window.nsfwjs = {
      load: async () => {
        calls.push(["model-load"]);
        if (options.model === "unavailable") throw new Error("offline");
        return {
          classify: async (canvas) => {
            calls.push(["classify", canvas.width, canvas.height]);
            const values =
              options.model === "suspect"
                ? [0.8, 0, 0.05, 0.15, 0]
                : options.model === "sexy"
                  ? [0, 0, 0.95, 0.05, 0]
                  : [0, 0, 0, 1, 0];
            return ["Porn", "Hentai", "Sexy", "Neutral", "Drawing"].map(
              (className, i) => ({ className, probability: values[i] }),
            );
          },
        };
      },
    };
  }, options);
}

// A destination must be chosen explicitly (nothing is preselected). Keeps an explicit choice already made.
export async function chooseDestination(page, value = "public") {
  if (await page.locator("[name=audience]:checked").count()) return;
  await page.locator(`[name=audience][value=${value}]`).check();
}
