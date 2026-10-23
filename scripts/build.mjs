import { mkdir, copyFile, cp, rm, access } from "node:fs/promises";
import { COUPLE_PHOTO, SUPABASE_KEY, SUPABASE_URL } from "../config.js";
if (
  SUPABASE_KEY.startsWith("sb_secret_") ||
  (SUPABASE_KEY.split(".").length === 3 &&
    JSON.parse(Buffer.from(SUPABASE_KEY.split(".")[1], "base64url")).role ===
      "service_role")
)
  throw new Error("Private key forbidden in browser config");
for (const file of [
  "vendor/supabase.js",
  "vendor/nsfwjs/nsfwjs.js",
  "vendor/nsfwjs/models/mobilenet_v2/model.json",
  "fonts/jost-latin-400-normal.woff2",
])
  await access(file);
// Only this generated directory is replaced. Never publish the repository root.
await rm("dist", { recursive: true, force: true });
await mkdir("dist/assets", { recursive: true });
for (const file of [
  "index.html",
  "admin.html",
  "app.css",
  "config.js",
  "shared.js",
  "uploads.js",
  "app.js",
  "admin.js",
  "export-zip.js",
  "export-photos.js",
  "robots.txt",
  "_headers",
  "404.html",
])
  await copyFile(file, `dist/${file}`);
for (const file of ["design_tokens.css", "favicon.svg", "botanical.svg", "botanical-sprig.svg"])
  await copyFile(`assets/${file}`, `dist/assets/${file}`);
for (const dir of ["vendor", "fonts", "assets/couple", "assets/fonts"])
  await cp(dir, `dist/${dir}`, { recursive: true });
if (COUPLE_PHOTO && !/^assets\/couple\/[a-zA-Z0-9_-]+\.jpg$/.test(COUPLE_PHOTO)) {
  if (!/^[a-zA-Z0-9_-]+\.(jpg|jpeg|webp|avif)$/i.test(COUPLE_PHOTO))
    throw new Error("Use a local hero filename at project root");
  await copyFile(COUPLE_PHOTO, `dist/${COUPLE_PHOTO}`);
}
if (COUPLE_PHOTO) await access(`dist/${COUPLE_PHOTO}`);

console.log(
  "PASS: static site prepared in dist/ (SQL, tests and source documentation excluded).",
);
if (!SUPABASE_URL)
  console.log(
    "NON TESTÉ: Supabase is not configured; uploads remain unavailable.",
  );
