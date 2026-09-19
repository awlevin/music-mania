// End-to-end run of a whole game in real browsers: one host, N phones.
//   node e2e/game.mjs            (expects the app on BASE_URL, default :3210)
// Screenshots land in e2e/shots/.

import { mkdirSync, readFileSync } from 'node:fs';

import { chromium, devices } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3210';
const ROUNDS = Number(process.env.ROUNDS ?? 10);
const NAMES = ['Ana', 'Benedict', 'Chidi'];
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

// The test knows what no player can: which song a preview URL belongs to.
const read = (file) => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8'));
const finales = read('finales.json');
const catalog = [...read('catalog.json'), ...finales];
const KIND_FIELD = { song: 'title', artist: 'artist', year: 'year', album: 'album' };

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const problems = [];
const watch = (page, who) => {
  page.on('pageerror', (e) => problems.push(`${who}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`${who}: ${m.text()}`));
};

const hostCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const host = await hostCtx.newPage();
watch(host, 'host');
// Previews are fetched in play order (each round prefetches the next), so the
// n-th distinct file the host asks for is round n's song.
const requested = [];
host.on('request', (r) => {
  if (!/\.(m4a|mp3)(\?|$)/.test(r.url())) return;
  const file = r.url().split('/').pop();
  const song = catalog.find((s) => s.previewUrl.split('/').pop() === file);
  if (song && !requested.includes(song)) requested.push(song);
});
await host.goto(BASE);
// Playwright hides carets by styling inputs; do that after hydration, not during it.
await host.waitForLoadState('networkidle');
await host.screenshot({ path: `${SHOTS}01-landing.png` });
await host.getByRole('button', { name: 'Host a game' }).click();
await host.waitForURL(/\/host\/[A-Z]{4}$/);
const code = host.url().slice(-4);
console.log('room', code);

const phones = [];
for (const name of NAMES) {
  const ctx = await browser.newContext({ ...devices['iPhone 14'] });
  const page = await ctx.newPage();
  watch(page, name);
  await page.goto(`${BASE}/play/${code}`);
  await page.waitForLoadState('networkidle');
  if (name === NAMES[0]) await page.screenshot({ path: `${SHOTS}02-phone-join.png` });
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Join game' }).click();
  await page.getByText(`You are in, ${name}`).waitFor();
  phones.push({ name, page });
}
await host.getByText(`In the room · ${NAMES.length}`).waitFor();
await host.screenshot({ path: `${SHOTS}03-host-lobby.png` });
await phones[0].page.screenshot({ path: `${SHOTS}04-phone-lobby.png` });

// No phone may ever hold an audio element.
const silent = async () => {
  for (const { name, page } of phones) {
    const count = await page.evaluate(() => document.querySelectorAll('audio,video').length);
    if (count) problems.push(`${name}: has ${count} media elements`);
  }
};

// Ana was first in, so she runs the game from her phone.
await phones[1].page.getByText('Ana starts the game').waitFor();
await phones[0].page.getByRole('button', { name: 'Start game' }).click();

for (let round = 0; round < ROUNDS; round++) {
  await host.getByText(/Get ready to name the/).waitFor();
  if (round === 0 || round === 3) {
    // A new kind of question is announced across the whole screen.
    await host.getByText(/Songs \d+ to \d+/).waitFor();
    await host.waitForTimeout(900);
    await host.screenshot({ path: `${SHOTS}05-host-chapter-${round + 1}.png` });
    await phones[0].page.screenshot({ path: `${SHOTS}06-phone-chapter-${round + 1}.png` });
  }
  await phones[0].page.getByRole('button', { name: 'Lock it in' }).waitFor({ timeout: 20000 });
  await silent();
  if (round === 0) {
    await host.waitForTimeout(1500);
    await host.screenshot({ path: `${SHOTS}07-host-guessing.png` });
    await phones[0].page.screenshot({ path: `${SHOTS}08-phone-guessing.png` });
  }

  const year = await phones[0].page.getByPlaceholder(/Year/).count();
  const noun = (await phones[0].page.locator('h1 em').textContent()).trim();
  const nowPlaying = requested[round];
  const right = nowPlaying ? String(nowPlaying[KIND_FIELD[noun]]) : null;
  // Ana answers; Benedict answers on even rounds; Chidi never does, except
  // in round two, where everyone answers and the reveal must come early.
  const answering = round === 1 ? phones : round % 2 === 0 ? phones.slice(0, 2) : phones.slice(0, 1);
  for (const { name, page } of answering) {
    // Ana knows her music. Benedict is a year out. Chidi guesses.
    let text = year ? '1999' : 'a wild guess';
    if (right && name === 'Ana') text = right;
    if (right && year && name === 'Benedict') text = String(Number(right) + 1);
    await page.getByRole('textbox').fill(text);
    await page.getByRole('button', { name: 'Lock it in' }).click();
  }
  if (round === 2) {
    await phones[2].page.getByRole('button', { name: 'Give up' }).click();
    await host.getByText('Gave up').first().waitFor();
    await host.waitForTimeout(1300);
    await host.screenshot({ path: `${SHOTS}10-host-gave-up.png` });
    await phones[2].page.screenshot({ path: `${SHOTS}10-phone-gave-up.png` });
  }
  if (round === 0) {
    await phones[0].page.getByText(/Locked in at/).waitFor();
    await phones[0].page.screenshot({ path: `${SHOTS}09-phone-locked.png` });
    await host.screenshot({ path: `${SHOTS}10-host-locked.png` });
  }

  const started = Date.now();
  await host.getByText('This round').waitFor({ timeout: 25000 });
  const waited = Date.now() - started;
  if (round === 1 && waited > 3000) problems.push(`round 2: reveal took ${waited} ms after all answered`);
  console.log(`round ${round + 1}: reveal after ${waited} ms`);

  if (round < 2 || round === 6 || round === 8) {
    await host.waitForTimeout(2600);
    await host.screenshot({ path: `${SHOTS}11-host-reveal-${round + 1}.png` });
    await phones[0].page.screenshot({ path: `${SHOTS}12-phone-reveal-${round + 1}.png` });
    await phones[2].page.screenshot({ path: `${SHOTS}12-phone-reveal-${round + 1}-noanswer.png` });
  }

  // Local only: a report on production would bench a real song for real players.
  if (round === 1 && /localhost|127\.0\.0\.1/.test(BASE)) {
    // Chidi thinks the album is wrong, and says so from his phone.
    const chidi = phones[2].page;
    await chidi.getByRole('button', { name: /Something off with this song/ }).click();
    await chidi.getByRole('button', { name: 'Wrong album' }).click();
    await chidi.getByLabel('Your feedback').fill('It was on the debut, not this one.');
    await chidi.screenshot({ path: `${SHOTS}15-phone-feedback.png` });
    await chidi.getByRole('button', { name: 'Send feedback' }).click();
    await chidi.getByText(/Got it. That is FB-\d+/).waitFor();
    await chidi.screenshot({ path: `${SHOTS}16-phone-feedback-sent.png` });
    await chidi.getByRole('button', { name: 'Back to the game' }).click();
    const board = await hostCtx.newPage();
    await board.goto(`${BASE}/feedback`);
    await board.getByText('It was on the debut, not this one.').first().waitFor();
    await board.screenshot({ path: `${SHOTS}17-feedback-board.png` });
    await board.close();
  }

  // Round one runs the reveal out; afterwards a phone skips ahead.
  if (round > 0) {
    await phones[round % 3].page.getByRole('button', { name: /Next song|See final scores/ }).click();
  }
}

if (ROUNDS < 10) {
  await browser.close();
  console.log(problems.length ? problems : 'ok (short run)');
  process.exit(problems.length ? 1 : 0);
}
await host.getByText('Top of the chart').waitFor({ timeout: 25000 });
await host.waitForTimeout(900);
await host.screenshot({ path: `${SHOTS}13-host-finished.png` });
await phones[0].page.screenshot({ path: `${SHOTS}14-phone-finished.png` });
await phones[2].page.screenshot({ path: `${SHOTS}14-phone-finished-last.png` });

const anaScore = await phones[0].page.locator('[class*=me] strong').textContent();
console.log('Ana finished on', anaScore);
if (!finales.some((f) => requested.at(-1)?.id === f.id)) problems.push('the final screen did not play a finale song');
if (Number(anaScore.replace(/,/g, '')) < 5000) problems.push(`Ana knew every song but scored ${anaScore}`);
await browser.close();
if (problems.length) {
  console.error('PROBLEMS:\n' + [...new Set(problems)].join('\n'));
  process.exit(1);
}
console.log('ok');
