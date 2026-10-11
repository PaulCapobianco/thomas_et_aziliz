// Real HTTP security test: supabase-js -> (PostgREST + Storage API) -> PostgreSQL with the three migrations.
// Intended for a DISPOSABLE stack only (see scripts/real-stack.sh). Never run it against production data:
// it creates photos and deletes the objects it created.
//   REAL_URL=http://127.0.0.1:5057 REAL_ANON=... REAL_ADMIN_JWT=... REAL_USER_JWT=... node scripts/real-http-test.mjs
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";

const { REAL_URL, REAL_ANON, REAL_ADMIN_JWT, REAL_USER_JWT } = process.env;
if (!REAL_URL || !REAL_ANON || !REAL_ADMIN_JWT || !REAL_USER_JWT) {
  console.error("NON TESTÉ: REAL_URL, REAL_ANON, REAL_ADMIN_JWT and REAL_USER_JWT are required.");
  process.exit(2);
}
const opts = (jwt) => ({
  auth: { persistSession: false, autoRefreshToken: false },
  global: jwt ? { headers: { Authorization: `Bearer ${jwt}` } } : {},
});
const anon = createClient(REAL_URL, REAL_ANON, opts());
const user = createClient(REAL_URL, REAL_ANON, opts(REAL_USER_JWT));
const admin = createClient(REAL_URL, REAL_ANON, opts(REAL_ADMIN_JWT));
const bucket = (sb) => sb.storage.from("photos");

// A tiny valid JPEG, made unique per photo by an appended comment-free trailer.
const BASE_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDMooormOo//9k=",
  "base64",
);
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const uploader = randomUUID();

let failures = 0;
const check = (name, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
};
const denied = (r) => !r.data?.signedUrl && !!r.error;

async function send(audience, nsfw, { seed = randomUUID(), client = anon, who = uploader } = {}) {
  const id = randomUUID();
  const body = Buffer.concat([BASE_JPEG, Buffer.from(seed)]); // differs by seed => distinct SHA-256
  const up = [];
  for (const kind of ["thumbs", "full"]) {
    up.push(
      await bucket(client).upload(`${audience}/${kind}/${id}.jpg`, body, {
        contentType: "image/jpeg",
        upsert: false,
      }),
    );
  }
  const reg = await client.rpc("register_photo", {
    p_id: id, p_audience: audience, p_sha256: sha(body), p_uploader: who, p_nsfw: nsfw,
  });
  return { id, hash: sha(body), uploadErrors: up.map((u) => u.error).filter(Boolean), reg, body, seed };
}
const paths = (id, aud) => [`${aud}/full/${id}.jpg`, `${aud}/thumbs/${id}.jpg`];
const fetchStatus = async (url) => (await fetch(url)).status;

// ---- 1. Guest upload over real HTTP and publication -------------------------------------------
const pub = await send("public", "clean");
check("A anonymous upload of thumb+full (real Storage RLS)", pub.uploadErrors.length === 0,
  pub.uploadErrors[0]?.message);
check("register_photo public clean => published", pub.reg.data?.result === "published", JSON.stringify(pub.reg.error ?? pub.reg.data));

const page = await anon.rpc("gallery_page", { p_limit: 100 });
check("gallery_page lists the published photo", page.data?.some((r) => r.id === pub.id));
const signed = await bucket(anon).createSignedUrls(paths(pub.id, "public"), 60);
check("published public photo can be signed by anon", signed.data?.every((s) => s.signedUrl), JSON.stringify(signed.error));
if (signed.data?.[0]?.signedUrl) {
  const res = await fetch(signed.data[0].signedUrl);
  const bytes = Buffer.from(await res.arrayBuffer());
  check("signed URL downloads the identical bytes", res.status === 200 && bytes.equals(pub.body), `HTTP ${res.status}`);
}

// ---- 2. Privacy of private / suspect / unavailable photos --------------------------------------
const priv = await send("maries", "skipped");
check("private (maries) upload accepted", priv.reg.data?.result === "published" && !priv.uploadErrors.length);
const sus = await send("public", "suspect");
check("suspect photo => pending_review", sus.reg.data?.result === "pending_review");
const unav = await send("public", "unavailable");
check("model unavailable => pending_review", unav.reg.data?.result === "pending_review");
for (const [label, p, aud] of [["private", priv, "maries"], ["suspect", sus, "public"], ["unavailable", unav, "public"]]) {
  const s = await bucket(anon).createSignedUrls(paths(p.id, aud), 60);
  check(`anon cannot sign a ${label} photo`, s.data?.every((x) => !x.signedUrl) ?? true, JSON.stringify(s.data));
  const direct = await fetchStatus(`${REAL_URL}/storage/v1/object/authenticated/photos/${paths(p.id, aud)[0]}`);
  check(`anon direct /object/authenticated read of ${label} photo refused`, direct >= 400, `HTTP ${direct}`);
  const viaPublic = await fetchStatus(`${REAL_URL}/storage/v1/object/public/photos/${paths(p.id, aud)[0]}`);
  check(`private bucket: /object/public of ${label} photo refused`, viaPublic >= 400, `HTTP ${viaPublic}`);
  const u = await bucket(user).createSignedUrls(paths(p.id, aud), 60);
  check(`non-admin authenticated user cannot sign a ${label} photo`, u.data?.every((x) => !x.signedUrl) ?? true);
}
// list() goes through the SELECT policy: it may only reveal files of PUBLISHED public photos (already in the gallery).
const hiddenIds = [priv.id, sus.id, unav.id];
const listings = await Promise.all(["public/thumbs", "public/full", "maries/thumbs", "maries/full", ""].map((d) => bucket(anon).list(d, { limit: 1000 })));
const listed = listings.flatMap((l) => l.data ?? []).map((o) => o.name);
check("anon list() never reveals private, suspect or unavailable files",
  !listed.some((n) => hiddenIds.some((id) => n.includes(id))) && !(listings[2].data?.length) && !(listings[3].data?.length),
  `${listed.length} entries visible`);
const gp = await anon.rpc("gallery_page", { p_limit: 100 });
check("gallery_page never returns private/suspect/unavailable",
  ![priv.id, sus.id, unav.id].some((id) => gp.data?.some((r) => r.id === id)));

// ---- 3. Guests cannot tamper -------------------------------------------------------------------
const cols = await anon.from("photos").select("id,uploader_id,original_sha256,review_reason");
check("anon cannot read uploader_id / sha256 / review_reason columns", !!cols.error, cols.error?.message);
const rows = await anon.from("photos").select("id,status,audience");
check("direct table read exposes only public+published rows",
  !rows.error && rows.data.every((r) => r.audience === "public" && r.status === "published"));
const upd = await anon.from("photos").update({ status: "published" }).eq("id", sus.id).select();
check("anon cannot UPDATE a photo status (suspect stays pending)",
  (upd.error || !upd.data?.length) && (await admin.rpc("admin_list_photos", { p_filter: "pending", p_limit: 200 })).data?.some((r) => r.id === sus.id));
const del = await anon.from("photos").delete().eq("id", pub.id).select();
check("anon cannot DELETE a photo", !!del.error || !del.data?.length);
const ins = await anon.from("photos").insert({ id: randomUUID(), audience: "public", status: "published", full_path: "x", thumb_path: "y", original_sha256: "0".repeat(64), uploader_id: randomUUID() });
check("anon cannot INSERT directly into photos", !!ins.error);
const rep = await anon.from("photo_reports").select("*");
check("anon cannot read photo_reports", !!rep.error || !rep.data?.length);
const fakeReport = await anon.from("photo_reports").insert({ photo_id: pub.id, reporter_id: randomUUID() });
check("anon cannot insert fake reports directly", !!fakeReport.error);
const settings = await anon.from("app_settings").update({ value: true }).eq("key", "publications_paused").select();
check("anon cannot change app_settings", !!settings.error || !settings.data?.length);
for (const [name, args] of [
  ["admin_status", {}], ["admin_orphans", {}], ["admin_set_paused", { p_paused: true }],
  ["admin_set_status", { p_id: sus.id, p_status: "published" }],
  ["admin_release_pending", { p_reason: "model_unavailable" }],
  ["admin_list_photos", { p_filter: "recent" }],
]) {
  const a = await anon.rpc(name, args);
  const u = await user.rpc(name, args);
  check(`${name} refused to anon and to a non-admin authenticated user`, !!a.error && !!u.error, `${a.error?.code}/${u.error?.code}`);
}
const ow = await bucket(anon).upload(paths(pub.id, "public")[0], BASE_JPEG, { contentType: "image/jpeg", upsert: true });
check("anon cannot overwrite an existing object (upsert)", !!ow.error);
const rm = await bucket(anon).remove(paths(pub.id, "public"));
const stillThere = await bucket(anon).createSignedUrls(paths(pub.id, "public"), 60);
check("anon cannot delete objects", stillThere.data?.every((s) => s.signedUrl), JSON.stringify(rm.data));
const html = await bucket(anon).upload(`public/full/${randomUUID()}.jpg`, Buffer.from("<html></html>"), { contentType: "text/html" });
check("bucket refuses non-JPEG content-type", !!html.error);
const big = await bucket(anon).upload(`public/full/${randomUUID()}.jpg`, Buffer.alloc(3145729, 1), { contentType: "image/jpeg" });
check("bucket refuses objects above 3 MiB", !!big.error);
const badPath = await bucket(anon).upload(`public/full/not-a-uuid.jpg`, BASE_JPEG, { contentType: "image/jpeg" });
check("Storage policy refuses a non-UUID path", !!badPath.error);
const otherDir = await bucket(anon).upload(`maries/other/${randomUUID()}.jpg`, BASE_JPEG, { contentType: "image/jpeg" });
check("Storage policy refuses an unknown folder", !!otherDir.error);

// ---- 4. Reports: two distinct browsers hide a photo ------------------------------------------
const rp = await send("public", "clean");
const url1 = (await bucket(anon).createSignedUrl(paths(rp.id, "public")[1], 3600)).data?.signedUrl;
const r1 = await anon.rpc("report_photo", { p_photo_id: rp.id, p_reporter: randomUUID(), p_reason: "other" });
const same = randomUUID();
const r2 = await anon.rpc("report_photo", { p_photo_id: rp.id, p_reporter: same, p_reason: "other" });
const r2b = await anon.rpc("report_photo", { p_photo_id: rp.id, p_reporter: same, p_reason: "other" });
check("first reports => reported; same browser twice => already_reported",
  r1.data?.result === "reported" && r2.data?.result === "reported" && r2b.data?.result === "not_found",
  [r1.data?.result, r2.data?.result, r2b.data?.result].join(","));
const afterHide = await bucket(anon).createSignedUrls(paths(rp.id, "public"), 60);
check("after 2 distinct reports the photo is hidden and no longer signable", afterHide.data?.every((s) => !s.signedUrl) ?? true);
if (url1) {
  const old = await fetchStatus(url1);
  console.log(`INFO signed URL delivered BEFORE hiding still answers HTTP ${old} (documented limit: valid until expiry)`);
}

// ---- 5. Concurrency: simultaneous uploads of the same file, and simultaneous reports -----------
const seed = randomUUID();
const burst = await Promise.all(Array.from({ length: 12 }, () => send("public", "clean", { seed })));
const results = burst.map((b) => b.reg.data?.result ?? `ERR:${b.reg.error?.code}`);
check("12 simultaneous uploads of the same file => exactly 1 published, 11 duplicates",
  results.filter((r) => r === "published").length === 1 && results.filter((r) => r === "duplicate").length === 11,
  results.join(","));
const raceTarget = await send("public", "clean");
const raceReports = await Promise.all(Array.from({ length: 6 }, () => anon.rpc("report_photo", { p_photo_id: raceTarget.id, p_reporter: randomUUID(), p_reason: "other" })));
const gone = await anon.rpc("gallery_page", { p_limit: 100 });
check("6 simultaneous reports hide the photo", !gone.data?.some((r) => r.id === raceTarget.id), raceReports.map((r) => r.data?.result).join(","));

// ---- 6. Another browser cannot hijack an existing registration ----------------------------------
const hijack = await anon.rpc("register_photo", { p_id: pub.id, p_audience: "public", p_sha256: pub.hash, p_uploader: randomUUID(), p_nsfw: "clean" });
check("a different browser cannot replay an existing photo id", hijack.error?.code === "42501");

// ---- 7. Admin really can read, moderate and delete ----------------------------------------------
const aSign = await bucket(admin).createSignedUrls([...paths(priv.id, "maries"), ...paths(sus.id, "public")], 60);
check("admin can sign private and suspect photos", aSign.data?.every((s) => s.signedUrl), JSON.stringify(aSign.error));
const st = await admin.rpc("admin_status");
check("admin_status works for the admin", !st.error && st.data.pending >= 2, JSON.stringify(st.error));
const rel = await admin.rpc("admin_set_status", { p_id: sus.id, p_status: "published" });
check("admin publishes a reviewed suspect photo", rel.data?.result === "published");
const sNow = await bucket(anon).createSignedUrls(paths(sus.id, "public"), 60);
check("the released photo is now signable by guests", sNow.data?.every((s) => s.signedUrl));
const hide = await admin.rpc("admin_set_status", { p_id: sus.id, p_status: "hidden" });
const del2 = await admin.rpc("admin_set_status", { p_id: sus.id, p_status: "deleted" });
const removed = await bucket(admin).remove(paths(sus.id, "public"));
check("admin hide + delete + Storage.remove removes both files",
  hide.data?.result === "hidden" && del2.data?.result === "deleted" && removed.data?.length === 2,
  `removed=${removed.data?.length}`);
const orph = await admin.rpc("admin_orphans");
check("admin_orphans callable", !orph.error);
const pause = await admin.rpc("admin_set_paused", { p_paused: true });
const paused = await send("public", "clean");
check("pause => new public photo is pending_review", pause.data?.paused === true && paused.reg.data?.result === "pending_review");
await admin.rpc("admin_set_paused", { p_paused: false });

// Clean up the objects this run created (admin session, Storage API).
const created = [pub, priv, unav, rp, raceTarget, paused, ...burst];
for (const p of created) {
  await bucket(admin).remove([...paths(p.id, "public"), ...paths(p.id, "maries")]);
}
console.log(failures ? `\n${failures} FAIL` : "\nALL PASS (real HTTP, disposable stack)");
process.exitCode = failures ? 1 : 0;
