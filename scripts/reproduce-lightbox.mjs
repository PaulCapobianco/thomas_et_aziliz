// Inspect the pre-change lightbox without checking out or modifying the working tree.
// node scripts/reproduce-lightbox.mjs c1e9875 http://127.0.0.1:4175
import { chromium, webkit, devices, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { installMock } from '../tests/mock.js';
import config from '../playwright.config.js';

const [revision = 'c1e9875', baseURL = 'http://127.0.0.1:4175'] = process.argv.slice(2);
const out = 'qa/lightbox';
const baseline = Object.fromEntries(['app.css', 'app.js', 'index.html'].map(file =>
  [file, execFileSync('git', ['show', `${revision}:${file}`], { encoding: 'utf8' })]));
const formats = [['portrait', 2000, 3000], ['landscape', 3000, 2000], ['square', 2000, 2000]];
const profiles = [
  ['iphone-se', webkit, { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } }],
  ['iphone-13', webkit, devices['iPhone 13']],
  ['pixel-7', chromium, devices['Pixel 7']],
  ['desktop', chromium, { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }],
];
const records = { before: [], 'before-rotated': [] };
for (const folder of Object.keys(records)) await mkdir(`${out}/${folder}`, { recursive: true });
for (const [device, engine, settings] of profiles) {
  const browser = await engine.launch(engine === webkit ? config.projects.find(p => p.name === 'webkit').use.launchOptions : {});
  try {
    const page = await browser.newPage(settings);
    await installMock(page, { photos: 3, photoUrls: formats.map(([name]) => `/fixtures/baseline-${name}.svg`) });
    for (const [file, body] of Object.entries(baseline)) {
      await page.route(file === 'index.html' ? `${baseURL}/` : `**/${file}`, route => route.fulfill({
        body, contentType: file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : 'text/html',
      }));
    }
    await page.route('**/fixtures/baseline-*.svg', route => {
      const [name, w, h] = formats.find(([name]) => route.request().url().endsWith(`baseline-${name}.svg`));
      return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#8eac80"/><rect x="20" y="20" width="${w-40}" height="${h-40}" fill="none" stroke="#243926" stroke-width="40"/><g fill="white" font-size="100" font-family="sans-serif" text-anchor="middle"><text x="${w/2}" y="130">HAUT ${name}</text><text x="${w/2}" y="${h-70}">BAS</text></g></svg>` });
    });
    await page.goto(`${baseURL}/`);
    const initial = page.viewportSize();
    for (const folder of Object.keys(records)) {
      if (folder === 'before-rotated') await page.setViewportSize({ width: initial.height, height: initial.width });
      for (let i = 0; i < formats.length; i++) {
        await page.locator('.photo-card').nth(i).click();
        await expect(page.locator('#lightbox-status')).toHaveText('');
        await expect.poll(() => page.locator('#full-photo').evaluate(img => img.complete && img.naturalWidth > 0)).toBeTruthy();
        const geometry = await page.evaluate(() => {
          const rect = selector => {
            const r = document.querySelector(selector).getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right };
          };
          const dialog = document.querySelector('#lightbox');
          return { viewport: [innerWidth, innerHeight], image: rect('#full-photo'), stage: rect('.lightbox-stage'), actions: rect('.lightbox-actions'), toolbar: rect('.lightbox-toolbar'), dialogScroll: [dialog.scrollHeight, dialog.clientHeight], fit: getComputedStyle(document.querySelector('#full-photo')).objectFit };
        });
        records[folder].push({ revision, device, orientation: formats[i][0], ...geometry });
        await page.screenshot({ path: `${out}/${folder}/${device}-${formats[i][0]}.png` });
        await page.locator('#close-lightbox').click();
      }
    }
  } finally { await browser.close(); }
}
for (const [folder, rows] of Object.entries(records)) {
  await writeFile(`${out}/${folder}.json`, JSON.stringify(rows, null, 2));
  const failures = rows.filter(g => g.fit !== 'contain' || g.image.y < g.toolbar.bottom - 1 || g.image.bottom > g.actions.y + 1 || g.image.right > g.viewport[0] + 1 || g.image.x < 0 || g.dialogScroll[0] > g.dialogScroll[1] + 1);
  console.log(`${folder}: ${rows.length} cases, ${failures.length} overflow/cropping indicators`);
  if (failures.length) process.exitCode = 1;
}
