// OPTIONAL experiment, not used by the site: CLIP zero-shot scoring of local images against a "sex toy" prompt,
// to see how such a detector would behave on ordinary photos (false positives) before ever considering it.
//   mkdir /tmp/clip-eval && cd /tmp/clip-eval && npm init -y && npm i @huggingface/transformers@3.7.6 sharp
//   cp <repo>/scripts/evaluate-clip-zeroshot.mjs . && node evaluate-clip-zeroshot.mjs DIR_OF_LOCAL_IMAGES
// Downloads the open-weight model Xenova/clip-vit-base-patch32 (int8: ~89 MB vision + ~64 MB text) from huggingface.co once;
// images stay on this machine. The label set is ad hoc: a high score on an ordinary photo shows why no threshold can be
// trusted without a labelled set of real positives.
import { CLIPVisionModelWithProjection, CLIPTextModelWithProjection, AutoProcessor, AutoTokenizer, RawImage, env } from "@huggingface/transformers";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
env.cacheDir = "./hf-cache";
const MODEL = "Xenova/clip-vit-base-patch32";
const dir = process.argv[2];
const files = (await readdir(dir)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort().map((f) => join(dir, f));
// Label set: the concept to catch against ordinary wedding / party / everyday content.
const target = ["a photo of a sex toy", "a photo of a dildo", "a photo of an adult toy"];
const normal = [
  "a photo of a wedding", "a photo of people in formal clothes", "a photo of a bride and groom", "a photo of a party",
  "a photo of people dancing", "a photo of food", "a photo of a child", "a photo of flowers", "a photo of a table setting",
  "a photo of a cake", "a photo of a landscape", "a photo of a bottle", "a photo of a candle", "a photo of a microphone",
  "a photo of a flashlight", "a photo of a cucumber", "a photo of a pepper mill", "a photo of an electric toothbrush", "a photo of a vase",
];
const labels = [...target, ...normal];
const t0 = performance.now();
const tokenizer = await AutoTokenizer.from_pretrained(MODEL);
const textModel = await CLIPTextModelWithProjection.from_pretrained(MODEL, { dtype: "q8" });
const visionModel = await CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: "q8" });
const processor = await AutoProcessor.from_pretrained(MODEL);
console.log("models loaded in", Math.round(performance.now() - t0), "ms");
const norm = (t) => { const a = Array.from(t); const n = Math.hypot(...a); return a.map((x) => x / n); };
const textEmb = [];
for (const l of labels) { const o = await textModel(tokenizer(l, { padding: true, truncation: true })); textEmb.push(norm(o.text_embeds.data)); }
const rows = []; const times = [];
for (const f of files) {
  const image = await RawImage.read(f);
  const s = performance.now();
  const o = await visionModel(await processor(image));
  times.push(performance.now() - s);
  const e = norm(o.image_embeds.data);
  const logits = textEmb.map((t) => 100 * t.reduce((a, x, i) => a + x * e[i], 0));
  const m = Math.max(...logits); const exp = logits.map((x) => Math.exp(x - m)); const z = exp.reduce((a, b) => a + b, 0);
  const prob = exp.map((x) => x / z);
  const pTarget = prob.slice(0, target.length).reduce((a, b) => a + b, 0);
  rows.push({ file: f.split("/").pop(), pTarget: +pTarget.toFixed(4), top: labels[prob.indexOf(Math.max(...prob))] });
}
console.table(rows);
times.sort((a, b) => a - b);
console.log("vision encoder median ms (Node CPU, q8):", Math.round(times[Math.floor(times.length / 2)]), " max pTarget on negatives:", Math.max(...rows.map((r) => r.pTarget)));
