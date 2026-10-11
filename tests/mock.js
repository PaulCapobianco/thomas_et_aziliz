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
    let paused = false,
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
    window.mock = {
      records,
      objects,
      calls,
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
    const url = "/fixtures/photo_01.jpg";
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
              const r = records.find(
                (r) => r.id === p.p_photo_id && r.status === "published",
              );
              if (!r) return ok({ result: "not_found" });
              if (r.reports.includes(p.p_reporter))
                return ok({ result: "already_reported" });
              r.reports.push(p.p_reporter);
              r.report_count = r.reports.length;
              if (r.report_count >= 2) r.status = "hidden";
              return ok({ result: "reported" });
            }
            if (name === "admin_status")
              return ok({
                paused,
                published: records.filter((r) => r.status === "published")
                  .length,
                reported: 0,
                pending: records.filter((r) => r.status === "pending_review")
                  .length,
                hidden: 0,
                maries: 0,
                storage_bytes: 123400,
                storage_objects: objects.size,
              });
            if (name === "admin_list_photos")
              return ok(
                records
                  .filter(
                    (r) =>
                      r.status !== "deleted" &&
                      (p.p_filter === "recent"
                        ? r.audience === "public"
                        : p.p_filter === "reported"
                          ? r.report_count > 0
                          : p.p_filter === "pending"
                            ? r.status === "pending_review"
                            : p.p_filter === "hidden"
                              ? r.status === "hidden"
                              : r.audience === "maries"),
                  )
                  .slice(p.p_offset, p.p_offset + p.p_limit),
              );
            if (name === "admin_set_paused") {
              paused = p.p_paused;
              return ok({ paused });
            }
            if (name === "admin_set_status") {
              const r = records.find((r) => r.id === p.p_id);
              r.status = p.p_status;
              if (p.p_status === "published") {
                r.report_count = 0;
                r.reports = [];
              }
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
                return ok(paths.map((path) => ({ path, signedUrl: url })));
              },
              createSignedUrl: async (path, ttl, opts) => {
                calls.push(["sign", path, ttl, opts]);
                return opts?.download
                  ? ok({ signedUrl: "/fixtures/photo_01.jpg?download=1" })
                  : ok({ signedUrl: url });
              },
              remove: async (paths) => {
                calls.push(["remove", paths]);
                return ok([]);
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
