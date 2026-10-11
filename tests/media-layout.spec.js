import { test, expect } from '@playwright/test';
import { readdir, writeFile } from 'node:fs/promises';
import { installMock } from './mock.js';
const formats = [
  ['portrait', 2000, 3000], ['portrait-tall', 1800, 3000],
  ['landscape', 3000, 2000], ['landscape-wide', 3000, 1500], ['square', 2000, 2000],
];
async function setup(page, photos = 150) {
  await installMock(page, { photos, photoUrls: formats.map(([name]) => `/fixtures/media-${name}.svg`) });
  await page.route('**/fixtures/media-*.svg', route => {
    const [name, w, h] = formats.find(([name]) => route.request().url().endsWith(`media-${name}.svg`));
    return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#91ac83"/><rect x="20" y="20" width="${w-40}" height="${h-40}" fill="none" stroke="#25412a" stroke-width="40"/><g fill="white" font-size="100" font-family="sans-serif" text-anchor="middle"><text x="${w/2}" y="130">HAUT ${name}</text><text x="${w/2}" y="${h-70}">BAS</text></g></svg>` });
  });
  await page.goto('/#souvenirs');
  await expect(page.locator('.photo-card')).toHaveCount(Math.min(48, photos));
}
async function ready(page) {
  await expect(page.locator('#lightbox-status')).toHaveText('');
  await expect.poll(() => page.locator('#full-photo').evaluate(i => i.complete && i.naturalWidth > 0)).toBeTruthy();
}
async function touch(page, type, points) {
  await page.locator('#full-photo').evaluate((image, {type,points}) => {
    const event = new Event(type, {bubbles:true});
    Object.defineProperty(event, type === 'touchend' ? 'changedTouches' : 'touches', {value:points});
    image.dispatchEvent(event);
  }, {type,points});
}
async function geometry(page) {
  return page.evaluate(() => {
    const box = selector => { const r=document.querySelector(selector).getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
    return { image:box('#full-photo'),frame:box('#photo-frame'),stage:box('.photo-viewport'),actions:box('#lightbox .lightbox-actions'),toolbar:box('#lightbox .lightbox-toolbar'),close:box('#close-lightbox'),next:box('#next'),previous:box('#previous'),view:[innerWidth,innerHeight],scroll:[document.querySelector('#lightbox').scrollHeight,document.querySelector('#lightbox').clientHeight],fit:getComputedStyle(document.querySelector('#full-photo')).objectFit,orientation:document.querySelector('#photo-frame').dataset.orientation };
  });
}
function contained(g) {
  expect(g.fit).toBe('contain');
  expect(g.image.width).toBeGreaterThan(0);expect(g.image.height).toBeGreaterThan(0);
  expect(g.image.x).toBeGreaterThanOrEqual(g.stage.x - 1);
  expect(g.image.y).toBeGreaterThanOrEqual(g.stage.y - 1);
  expect(g.image.right).toBeLessThanOrEqual(g.stage.right + 1);
  expect(g.image.bottom).toBeLessThanOrEqual(g.stage.bottom + 1);
  expect(g.image.y).toBeGreaterThanOrEqual(g.toolbar.bottom - 1);
  expect(g.image.bottom).toBeLessThanOrEqual(g.actions.y + 1);
  expect(g.image.right).toBeLessThanOrEqual(g.view[0]);
  expect(g.actions.bottom).toBeLessThanOrEqual(g.view[1] + 1);
  expect(g.scroll[0]).toBeLessThanOrEqual(g.scroll[1] + 1);
}
test('whole images, constant orientation frames, rotation and viewport height changes', async ({page}, info) => {
  await setup(page);
  await page.locator('.photo-card').first().click();
  const measurements=[];
  for(let i=0;i<formats.length;i++) {
    await ready(page);
    const g=await geometry(page);contained(g);measurements.push({name:formats[i][0],...g});
    await page.screenshot({path:info.outputPath(`${formats[i][0]}.png`)});
    if(i<formats.length-1) await page.locator('#next').click();
  }
  expect(measurements[0].frame).toEqual(measurements[1].frame);
  expect(measurements[2].frame).toEqual(measurements[3].frame);
  expect(measurements[2].frame).toEqual(measurements[4].frame);
  for(const g of measurements) { expect(g.actions).toEqual(measurements[0].actions);expect(g.next).toEqual(measurements[0].next); }
  const initial=page.viewportSize();
  for(const size of [{width:initial.height,height:initial.width},{...initial,height:initial.height-100},initial]) {
    await page.setViewportSize(size);
    await expect.poll(async()=>{try{contained(await geometry(page));return true;}catch{return false;}}).toBeTruthy();
    for(let i=0;i<5;i++) await page.keyboard.press("ArrowLeft");
    for(let i=0;i<5;i++) {
      await ready(page);
      const g=await geometry(page);contained(g);
      measurements.push({name:'resized',...g});
      if(i<4) await page.locator('#next').click();
    }
    await page.screenshot({path:info.outputPath(`resized-${size.width}-${size.height}.png`)});
  }
  await writeFile(info.outputPath('geometry.json'),JSON.stringify(measurements,null,2));
  await info.attach('geometry.json',{path:info.outputPath('geometry.json'),contentType:'application/json'});
});
test('uniform grid, old image sizes, lazy loading and reserved image space', async ({page}) => {
  await setup(page);
  const cards=page.locator('.photo-card');
  const sizes=await cards.evaluateAll(nodes=>nodes.map(n=>({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height})));
  for(const size of sizes) { expect(Math.abs(size.w-sizes[0].w)).toBeLessThan(.1);expect(Math.abs(size.h-sizes[0].h)).toBeLessThan(.1);expect(size.w/size.h).toBeCloseTo(.8,2); }
  expect(await cards.locator('img').evaluateAll(imgs=>imgs.every(i=>i.loading==='lazy'&&i.decoding==='async'))).toBeTruthy();
  await page.locator('.photo-card').last().scrollIntoViewIfNeeded();
  const after=await cards.evaluateAll(nodes=>nodes.map(n=>({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height})));
  expect(after).toEqual(sizes);
});
test('navigation, next page at boundary, scroll lock and restoration', async ({page, browserName, isMobile}) => {
  await setup(page);
  await page.locator('.photo-card').nth(47).scrollIntoViewIfNeeded();
  await page.evaluate(()=>document.documentElement.style.scrollBehavior='auto');
  const start=await page.evaluate(()=>scrollY);
  await page.locator('.photo-card').nth(47).click();await ready(page);
  await expect(page.locator('html')).toHaveClass(/photo-modal-open/);
  expect(await page.locator('body').evaluate(n=>getComputedStyle(n).position)).toBe('fixed');
  if (browserName === "webkit" && isMobile) await page.evaluate(() => window.scrollBy(0,400));
  else await page.mouse.wheel(0,400);
  expect(await page.evaluate(()=>scrollY)).toBe(0);
  await page.locator('#next').click();await ready(page);
  await expect(page.locator('#photo-position')).toHaveText('49 / 96');
  await page.keyboard.press('ArrowLeft');await ready(page);
  await expect(page.locator('#photo-position')).toHaveText('48 / 96');
  await touch(page,'touchstart',[{clientX:220,clientY:220}]);
  await touch(page,'touchend',[{clientX:110,clientY:220}]);
  await ready(page);await expect(page.locator('#photo-position')).toHaveText('49 / 96');
  await page.keyboard.press('ArrowRight');await ready(page);
  await expect(page.locator('#photo-position')).toHaveText('50 / 96');
  expect(await page.locator('.lightbox-stage').evaluate(n=>getComputedStyle(n).touchAction)).toContain('pinch-zoom');
  await touch(page,'touchstart',[{clientX:220,clientY:220},{clientX:100,clientY:220}]);
  await touch(page,'touchend',[{clientX:110,clientY:220}]);
  await expect(page.locator('#photo-position')).toHaveText('50 / 96');
  await page.keyboard.press('Escape');
  await expect(page.locator('#lightbox')).not.toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/photo-modal-open/);
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeCloseTo(start,0);
  await page.evaluate(()=>window.scrollTo(0,0));expect(await page.evaluate(()=>scrollY)).toBe(0);
});
test('pagination failure retries and an in-flight refresh cannot lose next-page navigation', async ({page}) => {
  await setup(page);
  await page.locator('.photo-card').nth(47).click();await ready(page);
  await page.evaluate(()=>mock.galleryDown=true);
  await page.locator('#next').click();
  await expect(page.locator('#lightbox-status')).toContainText('Réessayez');
  await expect(page.locator('#photo-position')).toHaveText('48 / 48');
  await page.evaluate(()=>{mock.galleryDown=false;mock.galleryDelay=150;document.querySelector('#refresh').click();});
  await page.locator('#next').click();
  await expect(page.locator('#photo-position')).toHaveText('49 / 96');
  await ready(page);
});
test('pending pagination respects a previous photo or a closed lightbox', async ({page}) => {
  await setup(page);
  await page.locator('.photo-card').nth(47).click();await ready(page);
  await page.evaluate(()=>mock.galleryDelay=500);
  await page.locator('#next').click();
  await page.locator('#previous').click();await ready(page);
  await expect(page.locator('#photo-position')).toHaveText('47 / 96');
  await page.locator('#close-lightbox').click();
  await page.locator('.photo-card').nth(95).click();await ready(page);
  await page.locator('#next').click();
  await page.locator('#close-lightbox').click();
  await expect(page.locator('.photo-card')).toHaveCount(144);
  await expect(page.locator('#lightbox')).not.toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/photo-modal-open/);
});
for (const optimized of [false,true]) test(`150 ${optimized ? 'thumbnail' : 'original'} gallery: scroll frame timing and layout stability`, async ({page},info) => {
  const originals=(await readdir('assets/couple')).filter(f=>f.endsWith('.jpg'));
  const photoUrls=originals.map((f,i)=>optimized ? `/fixtures/stress-${i}.jpg` : `/assets/couple/${f}`);
  await installMock(page,{photos:150,photoUrls,uniqueUrls:true});
  if (optimized) {
    await page.goto('/404.html');
    const thumbnails=await page.evaluate(async (originals)=>{
      const {canvasFor,jpeg,THUMB_MAX_SIDE,THUMB_QUALITY}=await import('/uploads.js');
      return Promise.all(originals.map(async name=>{
        const source=await createImageBitmap(await (await fetch(`/assets/couple/${name}`)).blob());
        const canvas=canvasFor(source,THUMB_MAX_SIDE),blob=await jpeg(canvas,THUMB_QUALITY);
        source.close();canvas.width=canvas.height=0;
        return new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob);});
      }));
    },originals);
    await page.route('**/fixtures/stress-*.jpg?*',route=>{
      const index=Number(new URL(route.request().url()).pathname.match(/stress-(\d+)/)[1]);
      return route.fulfill({contentType:'image/jpeg',body:Buffer.from(thumbnails[index],'base64')});
    });
  }
  await page.goto('/#souvenirs');
  for(const count of [48,96,144]) {await expect(page.locator('.photo-card')).toHaveCount(count);await page.locator('#more').click();}
  await expect(page.locator('.photo-card')).toHaveCount(150);
  const timing=await page.evaluate(async()=>{
    document.documentElement.style.scrollBehavior='auto';
    const samples=[];let last;let shift=0;
    const observer=typeof PerformanceObserver!=='undefined' && PerformanceObserver.supportedEntryTypes.includes('layout-shift') ? new PerformanceObserver(list=>{for(const entry of list.getEntries()) if(!entry.hadRecentInput) shift+=entry.value;}) : null;
    observer?.observe({type:'layout-shift'});
    const top=document.querySelector('#gallery').offsetTop,bottom=top+document.querySelector('#gallery').offsetHeight-innerHeight;
    for(let i=0;i<180;i++) await new Promise(resolve=>requestAnimationFrame(t=>{if(last)samples.push(t-last);last=t;window.scrollTo(0,top+(bottom-top)*i/179);resolve();}));
    observer?.disconnect();samples.sort((a,b)=>a-b);
    return {frames:samples.length,p95:samples[Math.floor(samples.length*.95)],max:Math.max(...samples),over50ms:samples.filter(n=>n>50).length,layoutShift:observer?shift:null,loaded:[...document.querySelectorAll('#gallery img')].filter(i=>i.complete&&i.naturalWidth>0).length};
  });
  await writeFile(info.outputPath('scroll-timing.json'),JSON.stringify(timing,null,2));
  await info.attach('scroll-timing.json',{path:info.outputPath('scroll-timing.json'),contentType:'application/json'});
  if(timing.layoutShift!==null) expect(timing.layoutShift).toBe(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:info.outputPath('gallery-150.png')});
});
