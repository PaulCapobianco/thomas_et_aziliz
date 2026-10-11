// Browser JPEG measurements on the seven supplied originals; never uploads or changes them.
// node scripts/measure-thumbnails.mjs /tmp/wedding-thumbnails http://127.0.0.1:4175
import { chromium } from '@playwright/test';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
const [out = '/tmp/wedding-thumbnails', baseURL = 'http://127.0.0.1:4173'] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`${baseURL}/404.html`);
  const rows = [];
  for (const name of (await readdir('assets/couple')).filter((name) => name.endsWith('.jpg')).sort()) {
    const data = (await readFile(`assets/couple/${name}`)).toString('base64');
    const results = await page.evaluate(async ({ data }) => {
      const { canvasFor, jpeg } = await import('/uploads.js');
      const source = await createImageBitmap(new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))]));
      // Compare at a common 3-column iPhone target: 320 x 400 device pixels.
      const display = (image) => {
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 400;
        const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.imageSmoothingQuality = 'high';
        const scale = Math.max(320 / image.width, 400 / image.height);
        ctx.drawImage(image, (320 - image.width * scale) / 2, (400 - image.height * scale) * .35, image.width * scale, image.height * scale);
        return ctx.getImageData(0, 0, 320, 400).data;
      };
      const reference = display(source), results = [];
      for (const [side, quality] of [[800, .75], [640, .84], ...[480, 560, 640].flatMap(s => [.85, .9, .93, .95].map(q => [s, q]))]) {
        const canvas = canvasFor(source, side), blob = await jpeg(canvas, quality), bitmap = await createImageBitmap(blob);
        const candidate = display(bitmap); let sum = 0;
        for (let i = 0; i < candidate.length; i++) if (i % 4 !== 3) sum += (candidate[i] - reference[i]) ** 2;
        const mse = sum / (320 * 400 * 3);
        const encoded = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.readAsDataURL(blob); });
        results.push({ side, quality, width: canvas.width, height: canvas.height, bytes: blob.size, psnr: 10 * Math.log10(255 ** 2 / mse), encoded });
        bitmap.close(); canvas.width = canvas.height = 0;
      }
      source.close(); return results;
    }, { data });
    for (const result of results) {
      const { encoded, ...measurement } = result;
      await writeFile(`${out}/${name}.${result.side}-${result.quality}.jpg`, Buffer.from(encoded, 'base64'));
      rows.push({ name, ...measurement });
    }
  }
  const combinations = [...new Set(rows.map(r => `${r.side}/${r.quality}`))].map(key => {
    const group = rows.filter(r => `${r.side}/${r.quality}` === key);
    return { side: group[0].side, quality: group[0].quality, averageKB: +(group.reduce((s,r)=>s+r.bytes,0)/group.length/1000).toFixed(1), minKB: +(Math.min(...group.map(r=>r.bytes))/1000).toFixed(1), maxKB: +(Math.max(...group.map(r=>r.bytes))/1000).toFixed(1), psnr: +(group.reduce((s,r)=>s+r.psnr,0)/group.length).toFixed(2) };
  });
  await writeFile(`${out}/measurements.json`, JSON.stringify({ rows, combinations }, null, 2));
  console.table(combinations);
} finally { await browser.close(); }
