// End-to-end runs of the two modes without a big screen, in real browsers.
//   node e2e/modes.mjs           (expects the app on BASE_URL, default :3210)
//   MODE=aux|solo|all (default all), ROUNDS=n (default 10),
//   STUB_AUDIO=1 answers preview requests with silence; CHROMIUM_PATH names a Chromium.
// Screenshots land in e2e/shots/ as aux-*.png and solo-*.png.

import { mkdirSync, readFileSync } from 'node:fs';

import { chromium, devices } from 'playwright';

import { stubAudio } from './stub.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3210';
const ROUNDS = Number(process.env.ROUNDS ?? 10);
const MODE = process.env.MODE ?? 'all';
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

// The test knows what no player can: which song a preview URL belongs to.
const read = (file) => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8'));
const finales = read('finales.json');
const catalog = [...read('catalog.json'), ...finales];
const KIND_FIELD = { song: 'title', artist: 'artist', year: 'year', album: 'album' };

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const problems = [];
const watch = (page, who) => {
  page.on('pageerror', (e) => problems.push(`${who}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`${who}: ${m.text()}`));
};

/** A phone. `requested` collects the songs whose previews this phone asked for, in order. */
async function phone(who) {
  const ctx = await browser.newContext({ ...devices['iPhone 14'] });
  const page = await ctx.newPage();
  watch(page, who);
  await stubAudio(page);
  const requested = [];
  page.on('request', (r) => {
    if (!/\.(m4a|mp3)(\?|$)/.test(r.url())) return;
    const file = r.url().split('/').pop();
    const song = catalog.find((s) => s.previewUrl.split('/').pop() === file);
    if (song && !requested.includes(song)) requested.push(song);
  });
  return { who, ctx, page, requested };
}

/** The answer the phone on screen is being asked for, from what the DJ's phone has fetched. */
async function rightAnswer(page, dj, round) {
  const year = await page.getByPlaceholder(/Year/).count();
  const noun = (await page.locator('h1 em').textContent()).trim();
  // The DJ prefetches the next song, so the n-th distinct file it asked for is
  // the n-th round it has played. (The lobby song is not in the catalog, so it
  // never counts.) A phone handed the aux mid-game starts counting from there.
  const nowPlaying = dj.requested[round - (dj.since ?? 0)];
  return { year: Boolean(year), right: nowPlaying ? String(nowPlaying[KIND_FIELD[noun]]) : null };
}

// ---------------------------------------------------------------------------

async function aux() {
  const ana = await phone('Ana');
  await ana.page.goto(BASE);
  await ana.page.waitForLoadState('networkidle');
  // On a phone the landing page opens on the aux card.
  await ana.page.getByRole('radio', { name: /Aux/ }).waitFor();
  await ana.page.screenshot({ path: `${SHOTS}aux-01-landing.png` });
  await ana.page.getByLabel('Your name').fill('Ana');
  await ana.page.getByRole('button', { name: 'Take the aux' }).click();
  await ana.page.waitForURL(/\/play\/[A-Z]{4}$/);
  const code = ana.page.url().slice(-4);
  console.log('aux room', code);
  await ana.page.getByText('You are on aux, Ana').waitFor();
  await ana.page.getByLabel(`Room code ${code}`).waitFor();
  await ana.page.waitForTimeout(800);
  await ana.page.screenshot({ path: `${SHOTS}aux-02-dj-lobby-alone.png` });

  const ben = await phone('Benedict');
  const cy = await phone('Chidi');
  for (const p of [ben, cy]) {
    await p.page.goto(`${BASE}/play/${code}`);
    await p.page.getByLabel('Your name').fill(p.who);
    await p.page.getByRole('button', { name: 'Join game' }).click();
    await p.page.getByText(`You are in, ${p.who}`).waitFor();
  }
  await ben.page.getByText('Ana has the aux').waitFor();
  await ana.page.getByText('On aux', { exact: true }).waitFor();
  await ana.page.screenshot({ path: `${SHOTS}aux-03-dj-lobby.png` });
  await ben.page.screenshot({ path: `${SHOTS}aux-04-phone-lobby.png` });

  // The cable goes to Chidi and comes back.
  await ana.page.getByRole('button', { name: 'Pass the aux' }).click();
  await ana.page.screenshot({ path: `${SHOTS}aux-05-pass-open.png` });
  await ana.page.getByRole('button', { name: 'Chidi' }).click();
  await cy.page.getByText('You are on aux, Chidi').waitFor();
  await ana.page.getByText('Chidi has the aux').waitFor();
  await cy.page.getByRole('button', { name: 'Pass the aux' }).click();
  await cy.page.getByRole('button', { name: 'Ana' }).click();
  await ana.page.getByText('You are on aux, Ana').waitFor();

  await ana.page.getByRole('button', { name: 'Start game' }).click();

  let dj = ana;
  const phones = () => [ana, ben, cy].filter((p) => !p.page.isClosed());
  for (let round = 0; round < ROUNDS; round++) {
    if (round === 1) {
      // Ana's phone dies between songs. Benedict waits, then takes the aux.
      await ana.page.close();
      await ben.page.getByText(/Still waiting on/).waitFor({ timeout: 25000 });
      await ben.page.screenshot({ path: `${SHOTS}aux-08-stall.png` });
      await ben.page.getByRole('button', { name: 'Take the aux' }).click();
      await ben.page.getByRole('button', { name: 'Turn sound on' }).waitFor();
      await ben.page.screenshot({ path: `${SHOTS}aux-09-sound-gate.png` });
      await ben.page.getByRole('button', { name: 'Turn sound on' }).click();
      dj = ben;
      dj.since = round;
      // Ana comes back, now just a player. Her seat is in her phone's storage.
      ana.page = await ana.ctx.newPage();
      watch(ana.page, 'Ana');
      await stubAudio(ana.page);
      await ana.page.goto(`${BASE}/play/${code}`);
    }
    for (const p of phones()) {
      await p.page.getByRole('button', { name: 'Lock it in' }).waitFor({ timeout: 30000 });
    }
    if (round === 0) {
      await ana.page.waitForTimeout(600);
      await ana.page.screenshot({ path: `${SHOTS}aux-06-dj-guessing.png` });
    }
    // Only the phone on aux ever asks for a preview.
    for (const p of phones()) {
      if (p !== dj && p.requested.length > 0 && !(p === ana && round > 0)) {
        problems.push(`${p.who} fetched a preview while not on aux`);
      }
    }
    const { year, right } = await rightAnswer(ana.page, dj, round);
    if (!right) problems.push(`round ${round + 1}: could not tell which song is playing`);
    // Ana knows her music. Benedict is a year out, or wrong. Chidi gives up in round 2.
    await ana.page.getByRole('textbox').fill(right ?? 'x');
    await ana.page.getByRole('button', { name: 'Lock it in' }).click();
    await ben.page.getByRole('textbox').fill(year ? String(Number(right) + 1) : 'a wild guess');
    await ben.page.getByRole('button', { name: 'Lock it in' }).click();
    if (round === 1) await cy.page.getByRole('button', { name: 'Give up' }).click();
    else {
      await cy.page.getByRole('textbox').fill(year ? '1999' : 'no idea');
      await cy.page.getByRole('button', { name: 'Lock it in' }).click();
    }

    // Everyone answered: the reveal follows at once, and every phone shows the board.
    const started = Date.now();
    await ana.page.getByText(/You are \d+(st|nd|rd|th) of 3/).waitFor({ timeout: 25000 });
    const waited = Date.now() - started;
    if (waited > 3000) problems.push(`round ${round + 1}: reveal took ${waited} ms after all answered`);
    console.log(`aux round ${round + 1}: reveal after ${waited} ms`);
    // The board is open without being asked for: there is no TV to look at.
    await ana.page.getByText('Benedict', { exact: true }).waitFor();
    if (round === 0) {
      await ana.page.waitForTimeout(900);
      await ana.page.screenshot({ path: `${SHOTS}aux-07-reveal-board.png`, fullPage: true });
    }
    if (round === 1) await cy.page.getByText('You gave up').waitFor();
    await cy.page.getByRole('button', { name: /Next song|See final scores/ }).click();
  }

  if (ROUNDS >= 10) {
    await ana.page.getByText('You are number one').waitFor({ timeout: 25000 });
    await ben.page.getByText('You finished 2nd').waitFor();
    await ana.page.screenshot({ path: `${SHOTS}aux-10-finished.png` });
    if (!finales.some((f) => dj.requested.at(-1)?.id === f.id)) problems.push('the aux phone did not play a finale');
  }
  for (const p of [ana, ben, cy]) await p.ctx.close();
}

// ---------------------------------------------------------------------------

async function solo() {
  const me = await phone('Solo');
  await me.page.goto(BASE);
  await me.page.waitForLoadState('networkidle');
  await me.page.getByRole('radio', { name: /Solo/ }).click();
  await me.page.waitForTimeout(400);
  await me.page.screenshot({ path: `${SHOTS}solo-01-landing.png` });
  await me.page.getByLabel('Your name').fill('Dee');
  await me.page.getByRole('button', { name: 'Play solo' }).click();
  await me.page.waitForURL(/\/play\/[A-Z]{4}$/);
  const code = me.page.url().slice(-4);
  console.log('solo room', code);

  // No lobby: the first thing on screen is the first question.
  await me.page.getByText('First up').waitFor();
  await me.page.screenshot({ path: `${SHOTS}solo-02-first-up.png` });

  // Nobody else can sit down. The refusal is a 409 the browser logs; that is the point.
  const stranger = await phone('Stranger');
  stranger.page.removeAllListeners('console');
  await stranger.page.goto(`${BASE}/play/${code}`);
  await stranger.page.getByLabel('Your name').fill('Eve');
  await stranger.page.getByRole('button', { name: 'Join game' }).click();
  await stranger.page.getByText('This is a solo game.').waitFor();
  await stranger.ctx.close();

  for (let round = 0; round < ROUNDS; round++) {
    await me.page.getByRole('button', { name: 'Lock it in' }).waitFor({ timeout: 30000 });
    if (round === 2) {
      // A reload mid-song: the sound needs one tap, then the song picks up where it is.
      await me.page.reload();
      await me.page.getByRole('button', { name: 'Turn sound on' }).waitFor();
      await me.page.screenshot({ path: `${SHOTS}solo-05-sound-gate.png` });
      await me.page.getByRole('button', { name: 'Turn sound on' }).click();
      await me.page.getByRole('button', { name: 'Lock it in' }).waitFor();
    }
    const { year, right } = await rightAnswer(me.page, me, round);
    if (!right) problems.push(`solo round ${round + 1}: could not tell which song is playing`);
    if (round === 0) await me.page.screenshot({ path: `${SHOTS}solo-03-guessing.png` });
    // Dee gets most of them, and is a year out once.
    const text = round === 4 ? 'nope' : year && round === 6 ? String(Number(right) + 1) : (right ?? 'x');
    await me.page.getByRole('textbox').fill(text);
    await me.page.getByRole('button', { name: 'Lock it in' }).click();
    await me.page.getByText(/^\+\d+$/).waitFor({ timeout: 5000 });
    if (await me.page.getByText(/You are \d+(st|nd|rd|th) of/).count()) problems.push('solo reveal shows a standing');
    if (round === 0) {
      await me.page.waitForTimeout(700);
      await me.page.screenshot({ path: `${SHOTS}solo-04-reveal.png` });
    }
    await me.page.getByRole('button', { name: /Next song|See your score/ }).click();
  }

  if (ROUNDS >= 10) {
    await me.page.getByText('Final score').waitFor({ timeout: 25000 });
    await me.page.getByText('Your first run').waitFor();
    await me.page.waitForTimeout(800);
    await me.page.screenshot({ path: `${SHOTS}solo-06-finished.png` });
    const score = await me.page.locator('h1 em').textContent();
    console.log('Dee finished on', score);
    if (Number(score.replace(/,/g, '')) < 6000) problems.push(`Dee knew most songs but scored ${score}`);
    // Once more: same room, ten new songs, and the best is remembered.
    await me.page.getByRole('button', { name: 'Play again' }).click();
    await me.page.getByRole('button', { name: 'Lock it in' }).waitFor({ timeout: 30000 });
    await me.page.getByRole('button', { name: 'Give up' }).click();
    await me.page.getByText('You gave up').waitFor();
  }
  await me.ctx.close();
}

// ---------------------------------------------------------------------------

try {
  if (MODE === 'aux' || MODE === 'all') await aux();
  if (MODE === 'solo' || MODE === 'all') await solo();
} finally {
  await browser.close();
}
if (problems.length) {
  console.error('PROBLEMS:\n' + [...new Set(problems)].join('\n'));
  process.exit(1);
}
console.log('ok');
