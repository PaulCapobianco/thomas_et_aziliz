// PLAN B — Edge Function "upload-url" (NON TESTÉE : à valider par un vrai envoi depuis un téléphone).
// Délivre des URL d'envoi signées pour le bucket privé "photos", après validation stricte des chemins.
// La clé service_role reste côté serveur (variable d'environnement fournie par Supabase, jamais dans le navigateur).
//
// Appel :  POST { "paths": ["public/thumbs/<uuid>.jpg", "public/full/<uuid>.jpg"] }
// Réponse: { "uploads": [{ "path": "...", "token": "..." }, ...] }
// Côté site : sb.storage.from('photos').uploadToSignedUrl(path, token, blob, { contentType: 'image/jpeg' })
import { createClient } from "npm:@supabase/supabase-js@2";

const PATH_RE =
  /^(public|maries)\/(full|thumbs)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;

const cors = {
  "Access-Control-Allow-Origin": "*", // à restreindre au domaine du site une fois connu
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { paths?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const paths = body.paths;
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 2 || !paths.every((p) => typeof p === "string" && PATH_RE.test(p))) {
    return json({ error: "invalid_paths" }, 400);
  }
  // Les deux chemins d'une même photo partagent le même audience et le même uuid.
  const ids = new Set(paths.map((p) => (p as string).split("/")[0] + (p as string).split("/")[2]));
  if (ids.size !== 1) return json({ error: "mismatched_paths" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const uploads: { path: string; token: string }[] = [];
  for (const path of paths as string[]) {
    const { data, error } = await admin.storage.from("photos").createSignedUploadUrl(path);
    if (error || !data) return json({ error: "sign_failed", detail: error?.message }, 500);
    uploads.push({ path, token: data.token });
  }
  return json({ uploads });
});
