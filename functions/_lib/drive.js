// Google Drive REST helpers (Workers-compatible: fetch only, no Node API). Scope used: drive.file (files created by this app only).
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

// kind: "auth" (token unusable, stop everything) | "quota" (Drive full, stop everything)
//       | "rate" (slow down, stop this run) | "transient" (retry later) | "permanent" (this photo only)
export class DriveError extends Error {
  constructor(kind, code, status = 0) {
    super(code);
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}
async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
function classify(status, body) {
  const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || body?.error || "";
  if (status === 401 || body?.error === "invalid_grant") return new DriveError("auth", "drive_auth", status);
  if (reason === "storageQuotaExceeded") return new DriveError("quota", "drive_full", status);
  if (status === 429 || /rateLimitExceeded|userRateLimitExceeded|dailyLimitExceeded|sharingRateLimitExceeded/i.test(reason)) return new DriveError("rate", "drive_rate_limited", status);
  if (status === 403) return new DriveError("auth", "drive_forbidden", status);
  if (status >= 500 || status === 408) return new DriveError("transient", `drive_${status}`, status);
  return new DriveError("permanent", `drive_${status}`, status);
}
async function call(fetchFn, url, init) {
  let response;
  try {
    response = await fetchFn(url, init);
  } catch {
    throw new DriveError("transient", "drive_network");
  }
  const body = await readJson(response);
  if (!response.ok) throw classify(response.status, body);
  return body;
}

export async function refreshAccessToken(fetchFn, env) {
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: env.GOOGLE_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  const data = await call(fetchFn, TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!data.access_token) throw new DriveError("auth", "drive_auth");
  return data.access_token;
}

// { limit, usage } in bytes; limit is null for unlimited accounts.
export async function storageQuota(fetchFn, token) {
  const data = await call(fetchFn, `${API}/about?fields=storageQuota`, { headers: { authorization: `Bearer ${token}` } });
  const quota = data.storageQuota || {};
  return { limit: quota.limit ? Number(quota.limit) : null, usage: Number(quota.usage || 0) };
}

// Duplicate guard: a file already created for this photo id (e.g. response lost after a successful upload).
export async function findByPhotoId(fetchFn, token, photoId) {
  const q = `appProperties has { key='photoId' and value='${photoId}' } and trashed=false`;
  const url = `${API}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent("files(id,size,md5Checksum)")}&pageSize=5`;
  const data = await call(fetchFn, url, { headers: { authorization: `Bearer ${token}` } });
  return data.files || [];
}

export async function uploadFile(fetchFn, token, { name, folderId, bytes, appProperties }) {
  const boundary = `b${crypto.randomUUID().replaceAll("-", "")}`;
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({ name, parents: [folderId], mimeType: "image/jpeg", appProperties }) +
      `\r\n--${boundary}\r\ncontent-type: image/jpeg\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);
  return call(fetchFn, `${UPLOAD}/files?uploadType=multipart&fields=${encodeURIComponent("id,size,md5Checksum")}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": `multipart/related; boundary=${boundary}` },
    body,
  });
}

// Used by the local setup script: creates (never reuses blindly) the private folder tree.
export async function createFolder(fetchFn, token, name, parentId) {
  const metadata = { name, mimeType: "application/vnd.google-apps.folder", ...(parentId ? { parents: [parentId] } : {}) };
  return call(fetchFn, `${API}/files?fields=id`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(metadata),
  });
}
