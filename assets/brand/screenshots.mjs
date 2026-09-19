// Takes the raw e2e screenshots and makes the ones the README shows:
// the three television frames, scaled down, and the two phone frames mounted
// side by side on the booth background.
//
//   npm run e2e && node assets/brand/screenshots.mjs

import { mkdirSync, readFileSync } from 'node:fs';

import { chromium } from 'playwright';

const shots = new URL('../../e2e/shots/', import.meta.url);
const out = new URL('../screenshots/', import.meta.url);
mkdirSync(out, { recursive: true });

const dataUrl = (name) =>
  `data:image/png;base64,${readFileSync(new URL(name, shots)).toString('base64')}`;

/** Television frames: the same picture, at a size a README can carry. */
const TV = [
  ['03-host-lobby.png', 'tv-lobby.png'],
  ['07-host-guessing.png', 'tv-guessing.png'],
  ['11-host-reveal-2.png', 'tv-reveal.png'],
];
/** Phone frames, mounted two to a picture. */
const PHONES = ['08-phone-guessing.png', '12-phone-reveal-2.png'];

const browser = await chromium.launch();

for (const [from, to] of TV) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.setContent(
    `<body style="margin:0"><img src="${dataUrl(from)}" style="display:block;width:1600px"></body>`,
  );
  await page.screenshot({ path: new URL(to, out).pathname });
  await page.close();
}

const page = await browser.newPage({ viewport: { width: 1064, height: 879 } });
await page.setContent(`<body style="margin:0">
  <div style="display:flex;gap:48px;padding:48px;background:#08222a">
    ${PHONES.map(
      (p) =>
        `<img src="${dataUrl(p)}" style="display:block;width:460px;border-radius:26px;
           box-shadow:0 18px 40px rgb(0 0 0 / .45)">`,
    ).join('')}
  </div>
</body>`);
await page.locator('div').screenshot({ path: new URL('phones.png', out).pathname });

await browser.close();
console.log('wrote assets/screenshots/');
