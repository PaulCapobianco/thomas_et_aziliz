// Local, offline evaluation of the NSFWJS models shipped in node_modules (nothing leaves this machine).
//   node scripts/evaluate-detector.mjs --negatives DIR [--positives DIR] [--models mobilenet_v2,mobilenet_v2_mid,inception_v3] [--json out.json]
// DIR = a folder of JPEG/PNG/WebP files you supply (e.g. ordinary wedding photos as negatives; test images that must be
// caught as positives). Images are only read locally and drawn on a canvas in headless Chromium; nothing is sent anywhere and
// nothing is copied into the repository. Reports, per model: weight size, load and classify time, the verdict of the CURRENT
// thresholds from uploads.js (suspect / clean), false-positive rate on the negatives and, if given, the detection rate on the
// positives, with the raw class probabilities' extremes. It never claims a guarantee: a small folder gives a rough idea only.
import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname, resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]?.startsWith("--") ? true : all[i + 1]]] : acc), []));
if (!args.negatives) { console.error("usage: --negatives DIR [--positives DIR] [--models a,b] [--json file]"); process.exit(2); }
const models = (args.models || "mobilenet_v2,mobilenet_v2_mid,inception_v3").split(",");
const SIZES = { mobilenet_v2: 224, mobilenet_v2_mid: 224, inception_v3: 299 };
const require = createRequire(import.meta.url);
const exts = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const listImages = async (dir) => (await readdir(dir)).filter((f) => exts.has(extname(f).toLowerCase())).sort().map((f) => join(dir, f));
const negatives = await listImages(resolve(args.negatives));
const positives = args.positives ? await listImages(resolve(args.positives)) : [];

// Unpack the model of the npm package (JSON + weight shards stored as base64 modules) into a temp folder.
const tmp = await mkdtemp(join(tmpdir(), "nsfw-eval-"));
const weightMB = {};
const kind = {}; // "graph" (frozen TF graph) or "layers" (Keras), as the loader needs to know
for (const name of models) {
  const base = `node_modules/nsfwjs/dist/models/${name}`;
  const model = require(resolve(`${base}/model.min.js`));
  kind[name] = model.modelTopology?.node ? "graph" : "layers";
  await writeFile(join(tmp, `${name}.json`), JSON.stringify(model));
  let bytes = 0;
  for (const group of model.weightsManifest) for (const path of group.paths) {
    const data = Buffer.from(require(resolve(`${base}/${path}.min.js`)), "base64");
    bytes += data.length;
    await writeFile(join(tmp, `${name}__${path}`), data);
  }
  weightMB[name] = bytes / 1e6;
}
const browser = await chromium.launch();
const page = await browser.newPage();
await page.route("http://eval.local/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  const send = async (file, type) => route.fulfill({ body: await readFile(file), contentType: type });
  if (path === "/blank") return route.fulfill({ contentType: "text/html", body: "<!doctype html><meta charset=utf-8><title>eval</title>" });
  if (path.startsWith("/m/")) {
    const [, , name, file] = path.split("/");
    const isJson = !file || file === "model.json";
    return send(join(tmp, isJson ? `${name}.json` : `${name}__${file}`), isJson ? "application/json" : "application/octet-stream");
  }
  return send(resolve(path.slice(1)), path.endsWith(".js") ? "application/javascript" : "application/octet-stream");
});
await page.goto("http://eval.local/blank");
const rows = [];
for (const name of models) {
  const result = await page.evaluate(async ({ name, size, type, negatives, positives }) => {
    const lib = await import("/vendor/nsfwjs/nsfwjs.js");
    const app = await import("/uploads.js");
    const t0 = performance.now();
    // The loader reads <base>/model.json: expose each model under its own virtual folder.
    const model = await lib.load(`/m/${name}/`, { size, type });
    const loadMs = performance.now() - t0;
    const run = async (items) => {
      const out = [];
      for (const { name: file, b64 } of items) {
        const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]);
        const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
        const canvas = app.canvasFor(bitmap, app.THUMB_MAX_SIDE); // exactly what the app classifies
        const s = performance.now();
        const predictions = await model.classify(canvas);
        const ms = performance.now() - s;
        const p = Object.fromEntries(predictions.map((x) => [x.className, x.probability]));
        out.push({ ms, explicit: p.Porn + p.Hentai, sexy: p.Sexy, neutral: p.Neutral, verdict: app.verdict(predictions) });
      }
      return out;
    };
    return { loadMs, negatives: await run(negatives), positives: await run(positives) };
  }, {
    name, size: SIZES[name] ?? 224, type: kind[name],
    negatives: await Promise.all(negatives.map(async (f) => ({ name: f, b64: (await readFile(f)).toString("base64") }))),
    positives: await Promise.all(positives.map(async (f) => ({ name: f, b64: (await readFile(f)).toString("base64") }))),
  });
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;
  const warm = result.negatives.concat(result.positives).slice(1).map((r) => r.ms); // first call compiles kernels
  rows.push({
    model: name, weightsMB: +weightMB[name].toFixed(1), loadMs: Math.round(result.loadMs), medianClassifyMs: Math.round(median(warm)),
    negatives: result.negatives.length, falsePositives: result.negatives.filter((r) => r.verdict === "suspect").length,
    maxExplicitNeg: +Math.max(0, ...result.negatives.map((r) => r.explicit)).toFixed(3), maxSexyNeg: +Math.max(0, ...result.negatives.map((r) => r.sexy)).toFixed(3),
    positives: result.positives.length, detected: result.positives.filter((r) => r.verdict === "suspect").length,
    positiveExplicit: result.positives.map((r) => +r.explicit.toFixed(3)), positiveSexy: result.positives.map((r) => +r.sexy.toFixed(3)),
  });
}
await browser.close();
await rm(tmp, { recursive: true, force: true });
console.table(rows.map(({ positiveExplicit, positiveSexy, ...r }) => r));
for (const r of rows) if (r.positives) console.log(`${r.model}: positives detected ${r.detected}/${r.positives}; Porn+Hentai per image ${JSON.stringify(r.positiveExplicit)}, Sexy ${JSON.stringify(r.positiveSexy)}`);
if (args.json) await writeFile(args.json, JSON.stringify(rows, null, 1));
