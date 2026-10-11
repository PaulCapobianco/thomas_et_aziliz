// Run manually against an EMPTY test project after applying the three migrations.
// Creates one tiny orphan object. No registration, deletion or privileged credential.
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { SUPABASE_URL, SUPABASE_KEY } from "../config.js";
if (!process.argv.includes("--test-project")) {
  console.error(
    "NON TESTÉ: run node scripts/verify-storage.mjs --test-project only after configuring a test project. This writes one tiny JPEG.",
  );
  process.exit(2);
}
if (
  !SUPABASE_URL ||
  !SUPABASE_KEY ||
  SUPABASE_KEY.startsWith("sb_secret_") ||
  (SUPABASE_KEY.split(".").length === 3 &&
    JSON.parse(Buffer.from(SUPABASE_KEY.split(".")[1], "base64url")).role ===
      "service_role")
) {
  console.error(
    "NON TESTÉ: URL and public key required in config.js; privileged keys are forbidden.",
  );
  process.exit(2);
}
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (url, options) =>
      fetch(url, { ...options, signal: AbortSignal.timeout(30000) }),
  },
});
const denied = (response) =>
  [400, 403, 404].includes(
    Number(response.error?.statusCode || response.error?.status),
  ) &&
  /not found|not exist|permission|row.level|not authorized/i.test(
    response.error?.message || "",
  ) &&
  !response.data?.signedUrl;
const jpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDMooormOo//9k=",
  "base64",
);
const id = randomUUID(),
  path = `public/thumbs/${id}.jpg`;
let failures = 0;
function check(name, pass, detail = "") {
  console.log(
    `${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`,
  );
  if (!pass) failures++;
}
const a = await sb.storage
  .from("photos")
  .upload(path, jpeg, { contentType: "image/jpeg", upsert: false });
check(
  "A anonymous upload",
  !a.error,
  a.error
    ? "Upload refused: inspect RLS and evaluate kit plan B. Never relax SELECT."
    : path,
);
if (a.error) {
  console.log("NON TESTÉ B/C: no uploaded object to test confidentiality");
  failures++;
} else {
  const b = await sb.storage.from("photos").createSignedUrl(path, 60);
  check("B unsigned orphan cannot be signed", denied(b));
  const c = await sb.storage.from("photos").list("public/thumbs");
  check(
    "C list is empty on an empty test project",
    !c.error && c.data?.length === 0,
  );
}
const d = await sb.rpc("check_duplicates", {
  p_audience: "public",
  p_hashes: [],
});
check("D public RPC", !d.error && Array.isArray(d.data) && d.data.length === 0);
const e = await sb.rpc("admin_status");
check("E admin RPC denied", e.error?.code === "42501");
for (const argument of process.argv.filter((arg) =>
  arg.startsWith("--denied-path="),
)) {
  const candidate = argument.slice("--denied-path=".length);
  if (!/^(public|maries)\/(full|thumbs)\/[a-f0-9-]{36}\.jpg$/.test(candidate))
    throw new Error("Invalid test path");
  const response = await sb.storage
    .from("photos")
    .createSignedUrl(candidate, 60);
  check(
    "F known private/pending/hidden object cannot be signed",
    denied(response),
    candidate,
  );
}
console.log(
  `Test path: ${path}. If A succeeded, this orphan is visible to admin_orphans after 30 minutes. No cleanup performed.`,
);
process.exitCode = failures ? 1 : 0;
