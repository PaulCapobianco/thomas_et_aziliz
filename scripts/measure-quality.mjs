// Measures what the upload pipeline really produces, in a real browser engine, for a list of photos.
//   node scripts/measure-quality.mjs OUT_DIR photo1.jpg photo2.jpg ...      (needs `npm run dev` on :4173)
// For every photo: legacy pipeline (1600 px q0.80 / 400 px q0.70, single-step resize) vs current pipeline (uploads.js constants).
// Writes the JPEGs to OUT_DIR and prints a JSON summary; scripts/quality_report.py scores sharpness and storage estimates.
import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename } from "node:path";

const [out, ...files] = process.argv.slice(2);
if (!out || !files.length) { console.error("usage: measure-quality.mjs OUT_DIR photo..."); process.exit(2); }
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("http://127.0.0.1:4173/404.html");
const summary = [];
for (const file of files) {
  const bytes = await readFile(file);
  const result = await page.evaluate(async ({ data, name }) => {
    const m = await import("/uploads.js");
    const blob = new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))]);
    const source = await m.decode(new File([blob], name, { type: "image/jpeg" }));
    const legacy = async (max, q) => {
      const ratio = Math.min(1, max / Math.max(source.width, source.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(source.width * ratio)); c.height = Math.max(1, Math.round(source.height * ratio));
      const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(source, 0, 0, c.width, c.height);
      const b = await m.jpeg(c, q); return { b, w: c.width, h: c.height };
    };
    const current = async (max, q) => {
      const c = m.canvasFor(source, max); const b = await m.jpegWithin(c, q); return { b, w: c.width, h: c.height };
    };
    const t0 = performance.now();
    const set = { legacyFull: await legacy(1600, 0.8), legacyThumb: await legacy(400, 0.7) };
    const t1 = performance.now();
    set.newFull = await current(m.FULL_MAX_SIDE, m.FULL_QUALITY);
    set.newThumb = await current(m.THUMB_MAX_SIDE, m.THUMB_QUALITY);
    const t2 = performance.now();
    const enc = async (b) => { const r = new FileReader(); return new Promise((ok) => { r.onload = () => ok(r.result.split(",")[1]); r.readAsDataURL(b); }); };
    const res = { source: [source.width, source.height], legacyMs: Math.round(t1 - t0), newMs: Math.round(t2 - t1) };
    for (const [k, v] of Object.entries(set)) res[k] = { w: v.w, h: v.h, bytes: v.b.size, data: await enc(v.b) };
    return res;
  }, { data: bytes.toString("base64"), name: basename(file) });
  const row = { file: basename(file), sourceBytes: bytes.length, source: result.source, legacyMs: result.legacyMs, newMs: result.newMs };
  for (const k of ["legacyFull", "legacyThumb", "newFull", "newThumb"]) {
    await writeFile(`${out}/${basename(file).replace(/\.\w+$/, "").replace(/\W+/g, "_")}.${k}.jpg`, Buffer.from(result[k].data, "base64"));
    row[k] = { w: result[k].w, h: result[k].h, bytes: result[k].bytes };
  }
  summary.push(row);
}
await browser.close();
await writeFile(`${out}/summary.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary.map(({ file, source, sourceBytes, legacyFull, newFull, legacyThumb, newThumb, legacyMs, newMs }) => ({
  file, source: source.join("x"), sourceKB: Math.round(sourceBytes / 1024),
  legacyFullKB: Math.round(legacyFull.bytes / 1024), newFull: `${newFull.w}x${newFull.h} ${Math.round(newFull.bytes / 1024)}KB`,
  legacyThumbKB: Math.round(legacyThumb.bytes / 1024), newThumb: `${newThumb.w}x${newThumb.h} ${Math.round(newThumb.bytes / 1024)}KB`, legacyMs, newMs,
})), null, 1));
