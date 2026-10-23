// POST /api/drive-sync  { "id"?: uuid }
// Authorization: Bearer <Supabase admin session JWT>   (admin page button)
//   or  X-Sync-Secret: <SYNC_SECRET>                    (scheduled call, see GUIDE_DRIVE.md)
// Off by default: DRIVE_SYNC_ENABLED must be exactly "true". Secrets live only in Cloudflare, never in the browser.
import { runSync } from "./sync.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sameSecret(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function isAdmin(request, env, fetchFn) {
  const auth = request.headers.get("authorization") || "";
  if (!/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(auth) || !env.SUPABASE_PUBLISHABLE_KEY) return false;
  try {
    const response = await fetchFn(`${env.SUPABASE_URL}/rest/v1/rpc/is_admin`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: auth, "content-type": "application/json" },
      body: "{}",
    });
    return response.ok && (await response.json()) === true;
  } catch {
    return false;
  }
}
export async function md5Hex(bytes) {
  const digest = await crypto.subtle.digest("MD5", bytes); // Workers extension of Web Crypto
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handle(request, env, deps = { fetchFn: fetch, md5Hex }) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (env.DRIVE_SYNC_ENABLED !== "true") return json({ error: "disabled" }, 503);
  const allowed = (String(env.SYNC_SECRET || "").length >= 32 && sameSecret(request.headers.get("x-sync-secret") || "", env.SYNC_SECRET)) || (await isAdmin(request, env, deps.fetchFn));
  if (!allowed) return json({ error: "unauthorized" }, 401);
  let onlyId = null;
  try {
    const body = await request.json();
    if (body?.id !== undefined) {
      if (typeof body.id !== "string" || !UUID.test(body.id)) return json({ error: "invalid_id" }, 400);
      onlyId = body.id;
    }
  } catch {
    /* empty body is fine */
  }
  try {
    const summary = await runSync(env, deps, { onlyId });
    return json(summary, summary.error === "not_configured" ? 503 : 200);
  } catch {
    // Never echo error details: they could contain request data. The photos stay queued (claimed ones are retried after 10 min).
    return json({ error: "internal" }, 500);
  }
}
