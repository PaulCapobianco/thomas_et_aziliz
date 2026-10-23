// Supabase Storage -> Google Drive copy. Copy only: nothing is ever deleted from Supabase or Drive here.
import { DriveError, refreshAccessToken, storageQuota, findByPhotoId, uploadFile } from "./drive.js";

export const REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
  "DRIVE_FOLDER_PUBLIC",
  "DRIVE_FOLDER_PRIVATE",
];
const MIN_FREE_BYTES = 500 * 1024 * 1024; // refuse to start a run below this margin on the Drive account
const MAX_BYTES = 3 * 1024 * 1024; // same ceiling as the Supabase bucket
const MAX_BATCH = 8; // 8 photos x ~5 subrequests stays under the 50 subrequests of the free Workers plan

async function supabaseRpc(fetchFn, env, name, params) {
  const response = await fetchFn(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error(`supabase_rpc_${name}_${response.status}`);
  return response.status === 204 ? null : response.json().catch(() => null);
}
async function downloadSource(fetchFn, env, path) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const response = await fetchFn(`${env.SUPABASE_URL}/storage/v1/object/photos/${encoded}`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!response.ok) throw new DriveError("permanent", response.status === 404 ? "source_missing" : `source_${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) throw new DriveError("permanent", "source_invalid_size");
  return bytes;
}
const stamp = (iso) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");

// Verifies that Drive holds exactly the bytes we sent before anything is marked as transferred.
function verified(file, bytes, md5) {
  return Number(file.size) === bytes.length && String(file.md5Checksum || "").toLowerCase() === md5;
}

export async function runSync(env, deps, { onlyId = null } = {}) {
  const { fetchFn, md5Hex } = deps;
  const missing = REQUIRED_ENV.filter((key) => !env[key]);
  if (missing.length) return { ok: false, error: "not_configured", missing };
  const summary = { ok: true, claimed: 0, transferred: 0, failed: 0, released: 0, bytes: 0, error: null };
  // Nothing waiting: do not even contact Google. Supabase unreachable: stop here, nothing was claimed.
  try {
    if (!onlyId && !(await supabaseRpc(fetchFn, env, "drive_queue_size", {}))) return { ...summary, idle: true };
  } catch {
    return { ...summary, ok: false, error: "supabase_unavailable" };
  }
  let token;
  try {
    token = await refreshAccessToken(fetchFn, env);
    const { limit, usage } = await storageQuota(fetchFn, token);
    if (limit !== null && limit - usage < MIN_FREE_BYTES) throw new DriveError("quota", "drive_full");
  } catch (error) {
    // Nothing was claimed yet: queue and source files are untouched.
    return { ...summary, ok: false, error: error.code || "drive_unreachable" };
  }
  const batch = Math.min(MAX_BATCH, Math.max(1, Number(env.DRIVE_BATCH) || 6));
  let claimed;
  try {
    claimed = (await supabaseRpc(fetchFn, env, "drive_claim", { p_limit: batch, p_id: onlyId })) || [];
  } catch {
    return { ...summary, ok: false, error: "supabase_unavailable" };
  }
  summary.claimed = claimed.length;
  for (let index = 0; index < claimed.length; index++) {
    const photo = claimed[index];
    try {
      const bytes = await downloadSource(fetchFn, env, photo.full_path);
      const md5 = await md5Hex(bytes);
      const folderId = photo.audience === "maries" ? env.DRIVE_FOLDER_PRIVATE : env.DRIVE_FOLDER_PUBLIC;
      let file = (await findByPhotoId(fetchFn, token, photo.id))[0];
      if (!file) {
        file = await uploadFile(fetchFn, token, {
          name: `${stamp(photo.created_at)}_${photo.id}.jpg`,
          folderId,
          bytes,
          appProperties: { photoId: photo.id, audience: photo.audience },
        });
      }
      if (!verified(file, bytes, md5)) throw new DriveError("permanent", "drive_verification_failed");
      await supabaseRpc(fetchFn, env, "drive_mark_transferred", {
        p_id: photo.id,
        p_file_id: file.id,
        p_bytes: bytes.length,
      });
      summary.transferred++;
      summary.bytes += bytes.length;
    } catch (error) {
      const code = error.code || "sync_error";
      if (error instanceof DriveError && ["auth", "quota", "rate"].includes(error.kind)) {
        // Global problem: this photo and the rest of the batch go back to the queue without using up an attempt.
        summary.ok = false;
        summary.error = code;
        for (const rest of claimed.slice(index)) {
          await supabaseRpc(fetchFn, env, "drive_release", { p_id: rest.id }).catch(() => {});
          summary.released++;
        }
        break;
      }
      await supabaseRpc(fetchFn, env, "drive_mark_failed", { p_id: photo.id, p_error: code }).catch(() => {});
      summary.failed++;
    }
  }
  return summary;
}
