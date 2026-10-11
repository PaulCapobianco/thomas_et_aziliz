import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";
const require = createRequire(import.meta.url);
await mkdir("vendor/nsfwjs/models/mobilenet_v2", { recursive: true });
await mkdir("fonts", { recursive: true });
await copyFile(
  "node_modules/@supabase/supabase-js/dist/umd/supabase.js",
  "vendor/supabase.js",
);
const bundle = await build({
  metafile: true,
  stdin: {
    contents: "export { load } from 'nsfwjs/core';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  minify: true,
  format: "esm",
  outfile: "vendor/nsfwjs/nsfwjs.js",
  legalComments: "linked",
});
const model = require("../node_modules/nsfwjs/dist/models/mobilenet_v2/model.min.js");
const shard = require("../node_modules/nsfwjs/dist/models/mobilenet_v2/group1-shard1of1.min.js");
await writeFile(
  "vendor/nsfwjs/models/mobilenet_v2/model.json",
  JSON.stringify(model),
);
await writeFile(
  "vendor/nsfwjs/models/mobilenet_v2/group1-shard1of1",
  Buffer.from(shard, "base64"),
);
for (const family of ["cormorant-garamond", "jost"]) {
  await copyFile(
    `node_modules/@fontsource/${family}/files/${family}-latin-400-normal.woff2`,
    `fonts/${family}-latin-400-normal.woff2`,
  );
  await copyFile(
    `node_modules/@fontsource/${family}/LICENSE`,
    `fonts/${family}-LICENSE.txt`,
  );
}
for (const [source, destination] of [
  ["nsfwjs", "nsfwjs"],
  ["@supabase/supabase-js", "supabase"],
]) {
  await copyFile(
    `node_modules/${source}/LICENSE`,
    `vendor/${destination}-LICENSE.txt`,
  );
}
console.log("PASS: local libraries, MobileNetV2 model and fonts prepared.");

await copyFile(
  "node_modules/@tensorflow/tfjs/README.md",
  "vendor/tensorflow-README.md",
);

if (
  Object.keys(bundle.metafile.inputs).some((path) =>
    /sprintf-js|argparse/.test(path),
  )
)
  throw new Error("Unexpected vulnerable CLI dependency in browser bundle");
console.log("PASS: argparse and sprintf-js excluded from browser bundle.");
