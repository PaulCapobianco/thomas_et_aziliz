// Build a visual-only Pages preview without access to the hosted Supabase project.
import { cp, readFile, rm, writeFile } from "node:fs/promises";

const output = "dist-preview";
await rm(output, { recursive: true, force: true });
await cp("dist", output, { recursive: true });

const path = `${output}/config.js`;
let config = await readFile(path, "utf8");
for (const key of ["SUPABASE_URL", "SUPABASE_KEY"]) {
  const pattern = new RegExp(`^export const ${key} = "[^"]*";`, "m");
  if (!pattern.test(config)) throw new Error(`Missing ${key} in preview config`);
  config = config.replace(pattern, `export const ${key} = "";`);
}
if (/supabase\.co|sb_(?:publishable|secret)_/.test(config))
  throw new Error("Hosted Supabase configuration remains in the preview config");
await writeFile(path, config);
console.log("PASS: dist-preview/ is isolated from hosted Supabase");
