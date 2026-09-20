// End-to-end run of a quick-play game in a real browser: one phone, no room.
//   node e2e/solo.mjs            (expects the app on BASE_URL, default :3210)
// Screenshots land in e2e/shots/.

import { mkdirSync, readFileSync } from 'node:fs';

import { chromium, devices } from 'playwright';

import { fakeAudio } from './fake-audio.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3210';
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

// The test knows what no player can: which song a preview URL belongs to.
const read = (file) => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8'));
const finales = read('finales.json');
const catalog = [...read('catalog.json'), ...finales];
const KIND_FIELD = { song: 'title', artist: 'artist', year: 'year', album: 'album' };

const browser = await chromium.launch({
  // A Chromium already on the machine, when Playwright's own is not installed.
  executablePath: process.env.CHROMIUM || undefined,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const problems = [];
const ctx = await browser.newContext({ ...devices['iPhone 14'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => problems.push(`page: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));

// Previews are fetched in play order (each round prefetches the next), so the
// n-th distinct file the page asks for is round n's song.
const requested = [];
page.on('request', (r) => {
  if (!/\.(m4a|mp3)(\?|$)/.test(r.url())) return;
  const file = r.url().split('/').pop();
  const song = catalog.find((s) => s.previewUrl.split('/').pop() === file);
  if (song && !requested.includes(song)) requested.push(song);
});

await fakeAudio(page);

await page.goto(`${BASE}/`);
await page.waitForLoadState('networkidle');
await page.getByRole('link', { name: 'Quick play' }).click();
await page.waitForURL(/\/solo$/);
await page.getByRole('heading', { name: /Just you and the/ }).waitFor();
await page.screenshot({ path: `${SHOTS}20-solo-start.png` });
await page.getByRole('button', { name: 'Play' }).click();

for (let round = 0; round < 10; round++) {
  await page.getByText(/Get ready to name the/).waitFor();
  if (round === 0 || round === 3) {
    // A new kind of question is announced across the whole screen.
    await page.getByText(/Songs \d+ to \d+/).waitFor();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${SHOTS}21-solo-chapter-${round + 1}.png` });
  }
  await page.getByRole('button', { name: 'Lock it in' }).waitFor({ timeout: 20000 });
  if (round === 0) {
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}22-solo-guessing.png` });
  }

  if (round === 4) {
    // A minute is needed. Every clock must stand still until Resume.
    await page.getByRole('button', { name: 'Pause the game' }).click();
    await page.getByRole('heading', { name: 'Intermission' }).waitFor();
    const before = await page.locator('[class*="countdown"]').textContent();
    await page.waitForTimeout(3200);
    const after = await page.locator('[class*="countdown"]').textContent();
    if (before !== after) problems.push(`the countdown moved while paused: ${before} → ${after}`);
    await page.screenshot({ path: `${SHOTS}23-solo-intermission.png` });
    await page.getByRole('button', { name: 'Resume' }).click();
    await page.getByRole('heading', { name: 'Intermission' }).waitFor({ state: 'hidden' });
  }

  const year = await page.getByPlaceholder(/Year/).count();
  const noun = (await page.locator('h1 em').first().textContent()).trim();
  const nowPlaying = requested[round];
  const right = nowPlaying ? String(nowPlaying[KIND_FIELD[noun]]) : null;

  if (round === 2) {
    // Nobody knows this one.
    await page.getByRole('button', { name: 'Give up' }).click();
  } else if (round === 7) {
    // Round eight runs out the clock: no answer at all.
  } else {
    // Right on most rounds, a year out on the first year round, a wild guess when the song is unknown.
    let text = year ? '1999' : 'a wild guess';
    if (right) text = year && round === 6 ? String(Number(right) + 1) : right;
    await page.getByRole('textbox').fill(text);
    await page.getByRole('button', { name: 'Lock it in' }).click();
  }

  const started = Date.now();
  await page.getByText(/^The (song|artist|year|album) was$/).waitFor({ timeout: 25000 });
  const waited = Date.now() - started;
  if (round !== 7 && waited > 3000) problems.push(`round ${round + 1}: reveal took ${waited} ms after locking in`);
  console.log(`round ${round + 1}: reveal after ${waited} ms`);

  if (round === 0 || round === 2 || round === 6) {
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS}24-solo-reveal-${round + 1}.png` });
  }

  if (round === 1 && /localhost|127\.0\.0\.1/.test(BASE)) {
    // The album looks wrong. Say so, with no room to say it from.
    await page.getByRole('button', { name: 'Something off with this song?' }).click();
    await page.getByRole('button', { name: 'Wrong album' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Send feedback' }).click();
    await page.getByText(/Got it. That is FB-\d+/).waitFor();
    await page.getByRole('button', { name: 'Back to the game' }).click();
  }

  // Round one runs the reveal out; afterwards skip ahead.
  if (round > 0) await page.getByRole('button', { name: /Next song|See your score/ }).click();
}

await page.getByText('Final score').waitFor({ timeout: 25000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SHOTS}25-solo-finished.png`, fullPage: true });

const score = await page.locator('[class*="finalScore"]').textContent();
console.log('finished on', score);
const numeric = Number(score.replace(/,/g, ''));
if (requested.length && numeric < 4000) problems.push(`knew most songs but scored ${score}`);
if (requested.length && !finales.some((f) => requested.at(-1)?.id === f.id)) {
  problems.push('the final screen did not play a finale song');
}
await page.getByText(/score to beat|personal best|Your best/).waitFor();

// Play again: a fresh set of songs, the score back to nothing.
await page.getByRole('button', { name: 'Play again' }).click();
await page.getByText(/Get ready to name the/).waitFor();
await page.getByRole('button', { name: 'Lock it in' }).waitFor({ timeout: 20000 });
const shown = await page.locator('[class*="score"]').first().textContent();
if (shown.trim() !== '0') problems.push(`the score did not reset for a new game: ${shown}`);

// The game survives a reload mid-song: back to the same round, with the sound gate.
await page.reload();
await page.getByRole('button', { name: 'Turn sound on' }).waitFor();
await page.screenshot({ path: `${SHOTS}26-solo-reloaded.png` });
await page.getByRole('button', { name: 'Turn sound on' }).click();
await page.getByRole('button', { name: 'Lock it in' }).waitFor({ timeout: 20000 });

// A wide screen gets the second column.
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}27-solo-wide.png` });

await browser.close();
if (problems.length) {
  console.error('PROBLEMS:\n' + [...new Set(problems)].join('\n'));
  process.exit(1);
}
console.log('ok');
