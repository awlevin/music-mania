#!/usr/bin/env node
// Work the feedback queue from a terminal (or from an agent).
//
//   node scripts/feedback.mjs list [--all]
//   node scripts/feedback.mjs close FB-12 --fixed "Moved it to the album Hot Fuss." [--commit <sha>]
//   node scripts/feedback.mjs close FB-13 --declined "The clip is the chorus; it stays."
//   node scripts/feedback.mjs reopen FB-12
//
// Needs FEEDBACK_ADMIN_TOKEN (the same value as on Vercel). FEEDBACK_URL
// defaults to production.

const BASE = process.env.FEEDBACK_URL ?? 'https://music-mania-three.vercel.app';
const TOKEN = process.env.FEEDBACK_ADMIN_TOKEN;
if (!TOKEN) {
  console.error('Set FEEDBACK_ADMIN_TOKEN first (vercel env pull gets it).');
  process.exit(2);
}
const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

const [command, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const at = rest.indexOf(`--${name}`);
  return at === -1 ? undefined : (rest[at + 1] ?? '');
};

async function call(path, init) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`${res.status}: ${body.error ?? 'request failed'}`);
    process.exit(1);
  }
  return body;
}

if (command === 'list') {
  const { items } = await call('/api/feedback');
  const shown = rest.includes('--all') ? items : items.filter((i) => i.status === 'open');
  if (rest.includes('--json')) {
    console.log(JSON.stringify(shown, null, 2));
  } else {
    for (const i of shown) {
      const song = i.song ? ` | ${i.issue}: "${i.song.title}" by ${i.song.artist} (${i.song.album}, ${i.song.year}) id=${i.song.id}` : '';
      const ctx = i.context ?? {};
      const where = [ctx.from, ctx.playerName, ctx.phase, ctx.questionKind && `q=${ctx.questionKind}`, ctx.answer && `typed="${ctx.answer}"`, ctx.appVersion]
        .filter(Boolean)
        .join(' ');
      console.log(`${i.id} [${i.status}] ${new Date(i.createdAt).toISOString().slice(0, 16)}${song}\n    ${i.text || '(no note)'}\n    (${where})`);
    }
    console.log(`\n${shown.length} shown, ${items.length} total.`);
  }
} else if (command === 'close' || command === 'reopen') {
  const id = rest[0];
  const fixed = flag('fixed');
  const declined = flag('declined');
  const status = command === 'reopen' ? 'open' : fixed !== undefined ? 'fixed' : 'declined';
  const resolution = fixed ?? declined;
  if (!id || (command === 'close' && !resolution)) {
    console.error('Usage: close FB-12 --fixed "what was done" [--commit sha] | --declined "why not"');
    process.exit(2);
  }
  const { item } = await call(`/api/feedback/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, resolution, commit: flag('commit') }),
  });
  console.log(`${item.id} is now ${item.status}.`);
} else {
  console.error('Commands: list [--all] [--json] | close <id> --fixed|--declined "<note>" [--commit sha] | reopen <id>');
  process.exit(2);
}
