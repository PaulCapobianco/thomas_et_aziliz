import test from "node:test";
import assert from "node:assert/strict";
import { runSync } from "../functions/_lib/sync.js";
import { handle } from "../functions/_lib/handler.js";
import { ENV, makeWorld, md5Hex } from "./fakes.mjs";

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const two = () => makeWorld({ photos: [
  { id: ID1, audience: "public", full_path: `public/full/${ID1}.jpg` },
  { id: ID2, audience: "maries", full_path: `maries/full/${ID2}.jpg` },
] });
const deps = (w) => ({ fetchFn: w.fetch, md5Hex });
const noDeletes = (w) => assert.ok(!w.calls.some((c) => /^DELETE|remove|trash/i.test(c)), "no delete/trash call may ever be made");

test("4 - public and private photos reach Drive, in the right folder, verified, nothing deleted", async () => {
  const w = two();
  const r = await runSync(ENV, deps(w));
  assert.deepEqual([r.ok, r.transferred, r.failed], [true, 2, 0]);
  const files = [...w.drive.values()];
  assert.equal(files.find((f) => f.appProperties.photoId === ID1).parents[0], "folder-public");
  assert.equal(files.find((f) => f.appProperties.photoId === ID2).parents[0], "folder-private");
  assert.ok(w.photos.every((p) => p.status === "transferred" && p.file_id));
  assert.ok(w.storage.size === 2, "source files in Supabase are kept");
  noDeletes(w);
});

test("6 - Drive connection failure (invalid token): nothing claimed, nothing lost", async () => {
  const w = two();
  w.tokenStatus = 400;
  const r = await runSync(ENV, deps(w));
  assert.deepEqual([r.ok, r.error, r.claimed], [false, "drive_auth", 0]);
  assert.ok(w.photos.every((p) => p.status === "pending" && p.attempts === 0));
  assert.equal(w.storage.size, 2);
});

test("6b - Drive unavailable (503): photo marked failed with the error, source kept", async () => {
  const w = two();
  w.uploadFault = "503";
  const r = await runSync(ENV, deps(w));
  assert.deepEqual([r.transferred, r.failed], [0, 2]);
  assert.ok(w.photos.every((p) => p.status === "failed" && p.error === "drive_503"));
  assert.equal(w.storage.size, 2);
  noDeletes(w);
});

test("7 - retry after a lost response creates no duplicate", async () => {
  const w = makeWorld({ photos: [{ id: ID1, audience: "public", full_path: `public/full/${ID1}.jpg` }] });
  w.uploadFault = "network-after-create";
  const first = await runSync(ENV, deps(w));
  assert.equal(first.failed, 1);
  assert.equal(w.drive.size, 1, "Drive did receive the file");
  w.photos[0].status = "pending"; // what the automatic retry / admin retry does
  const second = await runSync(ENV, deps(w));
  assert.equal(second.transferred, 1);
  assert.equal(w.drive.size, 1, "still exactly one file on Drive");
  assert.equal(w.photos[0].file_id, "drive-1");
});

test("7b - a second concurrent run finds nothing to claim (no double upload)", async () => {
  const w = two();
  await runSync(ENV, deps(w));
  const again = await runSync(ENV, deps(w));
  assert.equal(again.claimed, 0);
  assert.equal(w.drive.size, 2);
});

test("8 - corrupted/incomplete transfer is never marked transferred", async () => {
  const w = two();
  w.corruptMd5 = true;
  const r = await runSync(ENV, deps(w));
  assert.equal(r.transferred, 0);
  assert.ok(w.photos.every((p) => p.status === "failed" && p.error === "drive_verification_failed"));
});

test("8b - source missing in Supabase: failed with a clear error, no Drive file", async () => {
  const w = two();
  w.storage.delete(`public/full/${ID1}.jpg`);
  const r = await runSync(ENV, deps(w));
  assert.deepEqual([r.transferred, r.failed], [1, 1]);
  assert.equal(w.photos[0].error, "source_missing");
});

test("Drive almost full: run refused before claiming anything", async () => {
  const w = two();
  w.aboutQuota = { limit: "1000000000", usage: "900000000" };
  const r = await runSync(ENV, deps(w));
  assert.deepEqual([r.ok, r.error, r.claimed], [false, "drive_full", 0]);
  assert.ok(w.photos.every((p) => p.status === "pending"));
});

test("Drive full during upload: whole batch released without using attempts", async () => {
  const w = two();
  w.uploadFault = "quota";
  const r = await runSync(ENV, deps(w));
  assert.deepEqual([r.ok, r.error, r.released, r.failed], [false, "drive_full", 2, 0]);
  assert.ok(w.photos.every((p) => p.status === "pending" && p.attempts === 0));
});

test("missing configuration is reported, nothing is called", async () => {
  const w = two();
  const r = await runSync({ ...ENV, GOOGLE_REFRESH_TOKEN: "" }, deps(w));
  assert.deepEqual([r.ok, r.error], [false, "not_configured"]);
  assert.equal(w.calls.length, 0);
});

test("batch stays under the free-plan subrequest limit (50)", async () => {
  const photos = Array.from({ length: 20 }, (_, i) => {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    return { id, audience: "public", full_path: `public/full/${id}.jpg` };
  });
  const w = makeWorld({ photos });
  await runSync({ ...ENV, DRIVE_BATCH: "50" }, deps(w));
  assert.ok(w.calls.length <= 50, `${w.calls.length} subrequests`);
});

const post = (headers = {}, body = "{}") => new Request("https://site.test/api/drive-sync", { method: "POST", headers, body });
test("endpoint: disabled by default, then auth required", async () => {
  const w = two();
  assert.equal((await handle(post(), { ...ENV, DRIVE_SYNC_ENABLED: "" }, deps(w))).status, 503);
  assert.equal((await handle(post(), ENV, deps(w))).status, 401);
  assert.equal((await handle(post({ "x-sync-secret": "wrong" }), ENV, deps(w))).status, 401);
  assert.equal((await handle(post({ authorization: "Bearer aaa.bbb.guest" }), ENV, deps(w))).status, 401, "non-admin JWT refused");
  assert.equal((await handle(new Request("https://site.test/api/drive-sync"), ENV, deps(w))).status, 405);
  assert.equal(w.drive.size, 0);
});
test("endpoint: secret or admin JWT runs the sync; response leaks no secret", async () => {
  for (const headers of [{ "x-sync-secret": ENV.SYNC_SECRET }, { authorization: "Bearer aaa.bbb.admin" }]) {
    const w = two();
    const response = await handle(post(headers), ENV, deps(w));
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(text).transferred, 2);
    for (const secret of [ENV.GOOGLE_CLIENT_SECRET, ENV.GOOGLE_REFRESH_TOKEN, ENV.SUPABASE_SERVICE_ROLE_KEY, ENV.SYNC_SECRET, "access-fake"])
      assert.ok(!text.includes(secret));
  }
});
test("endpoint: single photo id validated and honoured", async () => {
  const w = two();
  assert.equal((await handle(post({ "x-sync-secret": ENV.SYNC_SECRET }, '{"id":"nope"}'), ENV, deps(w))).status, 400);
  const response = await handle(post({ "x-sync-secret": ENV.SYNC_SECRET }, JSON.stringify({ id: ID2 })), ENV, deps(w));
  assert.equal((await response.json()).transferred, 1);
  assert.equal(w.photos.find((p) => p.id === ID1).status, "pending");
});
