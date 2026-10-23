// Fake Supabase (RPC + Storage) and fake Google Drive, in memory. No network, no secret.
import { createHash } from "node:crypto";

export const md5Hex = (bytes) => createHash("md5").update(bytes).digest("hex");
export const ENV = {
  SUPABASE_URL: "https://fake.supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-fake",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fake",
  GOOGLE_CLIENT_ID: "cid",
  GOOGLE_CLIENT_SECRET: "csecret",
  GOOGLE_REFRESH_TOKEN: "rtoken",
  DRIVE_FOLDER_PUBLIC: "folder-public",
  DRIVE_FOLDER_PRIVATE: "folder-private",
  DRIVE_SYNC_ENABLED: "true",
  SYNC_SECRET: "sync-secret-fake-0123456789abcdef0123456789abcdef",
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function makeWorld({ photos, quota = { limit: "16106127360", usage: "1000" } } = {}) {
  const w = {
    photos: photos.map((p) => ({ status: "pending", attempts: 0, file_id: null, error: null, created_at: "2026-10-29T18:30:00Z", ...p })),
    storage: new Map(photos.map((p) => [p.full_path, p.bytes ?? new Uint8Array([1, 2, 3, p.audience === "maries" ? 9 : 7])])),
    drive: new Map(), // id -> { id, name, parents, appProperties, bytes }
    calls: [],
    // fault injection
    supabaseFault: null, tokenStatus: 200, aboutQuota: quota, uploadFault: null, corruptMd5: false, adminOk: true,
  };
  w.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || "GET";
    w.calls.push(`${method} ${u.host}${u.pathname}`);
    if (u.host === "oauth2.googleapis.com") {
      return w.tokenStatus === 200 ? json({ access_token: "access-fake" }) : json({ error: "invalid_grant" }, w.tokenStatus);
    }
    if (u.host === "www.googleapis.com" && u.pathname === "/drive/v3/about") return json({ storageQuota: w.aboutQuota });
    if (u.host === "www.googleapis.com" && u.pathname === "/drive/v3/files" && method === "GET") {
      const id = /value='([^']+)'/.exec(u.searchParams.get("q"))[1];
      return json({ files: [...w.drive.values()].filter((f) => f.appProperties.photoId === id).map(publicFile(w)) });
    }
    if (u.host === "www.googleapis.com" && u.pathname === "/upload/drive/v3/files") {
      if (w.uploadFault === "503") return json({ error: { errors: [{ reason: "backendError" }] } }, 503);
      if (w.uploadFault === "quota") return json({ error: { errors: [{ reason: "storageQuotaExceeded" }] } }, 403);
      if (w.uploadFault === "network-after-create") w.pendingLoss = true;
      const text = new TextDecoder("latin1").decode(init.body);
      const meta = JSON.parse(/\r\n\r\n(\{.*?\})\r\n--/s.exec(text)[1]);
      const start = init.body.length - 0;
      const bytes = extractFile(init.body);
      const file = { id: `drive-${w.drive.size + 1}`, name: meta.name, parents: meta.parents, appProperties: meta.appProperties, bytes };
      w.drive.set(file.id, file);
      if (w.uploadFault === "network-after-create") { w.uploadFault = null; throw new TypeError("network lost"); }
      return json(publicFile(w)(file));
    }
    if (u.host === "fake.supabase.test" && u.pathname.startsWith("/storage/v1/object/photos/")) {
      const path = decodeURIComponent(u.pathname.replace("/storage/v1/object/photos/", ""));
      if (w.supabaseFault === "download") return json({ error: "unavailable" }, 503);
      return w.storage.has(path) ? new Response(w.storage.get(path)) : json({ error: "not_found" }, 404);
    }
    if (u.host === "fake.supabase.test" && u.pathname === "/rest/v1/rpc/is_admin") {
      return json(init.headers.authorization === "Bearer aaa.bbb.admin" && w.adminOk);
    }
    if (u.host === "fake.supabase.test" && u.pathname.startsWith("/rest/v1/rpc/")) {
      const name = u.pathname.split("/").pop();
      const body = JSON.parse(init.body);
      const row = (id) => w.photos.find((p) => p.id === id);
      if (w.supabaseFault === name || w.supabaseFault === "all") return json({ message: "boom" }, 503);
      if (name === "drive_queue_size") return json(w.photos.filter((p) => p.status === "pending").length);
      if (name === "drive_claim") {
        const picked = w.photos.filter((p) => p.status === "pending" && (!body.p_id || p.id === body.p_id)).slice(0, body.p_limit);
        for (const p of picked) { p.status = "processing"; p.attempts++; }
        return json(picked.map((p) => ({ id: p.id, audience: p.audience, full_path: p.full_path, created_at: p.created_at, drive_file_id: p.file_id, attempts: p.attempts })));
      }
      if (name === "drive_mark_transferred") Object.assign(row(body.p_id), { status: "transferred", file_id: body.p_file_id, bytes_done: body.p_bytes });
      if (name === "drive_mark_failed") Object.assign(row(body.p_id), { status: "failed", error: body.p_error });
      if (name === "drive_release") Object.assign(row(body.p_id), { status: "pending", attempts: row(body.p_id).attempts - 1 });
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected request ${method} ${url}`);
  };
  return w;
}
function publicFile(w) {
  return (f) => ({ id: f.id, size: String(f.bytes.length), md5Checksum: w.corruptMd5 ? "0".repeat(32) : md5Hex(f.bytes) });
}
// The multipart body is head + file bytes + tail; recover the file bytes between the headers and the closing boundary.
function extractFile(body) {
  const marker = new TextEncoder().encode("content-type: image/jpeg\r\n\r\n");
  let start = -1;
  outer: for (let i = 0; i < body.length - marker.length; i++) {
    for (let j = 0; j < marker.length; j++) if (body[i + j] !== marker[j]) continue outer;
    start = i + marker.length;
  }
  const tailLength = body.length - new TextDecoder("latin1").decode(body).lastIndexOf("\r\n--");
  return body.slice(start, body.length - tailLength);
}
