// Renders assets/brand/banner.html to assets/brand/banner.png (1280x640),
// the image the README opens with and GitHub shows as the social preview.
//
//   node assets/brand/render.mjs
//
// Needs a network connection: the banner pulls its fonts from Google Fonts.

import { chromium } from 'playwright';

const here = new URL('./', import.meta.url);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });

await page.goto(new URL('banner.html', here).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.locator('.banner').screenshot({ path: new URL('banner.png', here).pathname });

await browser.close();
console.log('wrote assets/brand/banner.png');
