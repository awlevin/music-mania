// Stand-in audio for machines that cannot reach Apple's CDN (CI, a sandbox).
// With STUB_AUDIO=1 every preview request a page makes is answered with a
// silent WAV, so the game runs exactly as it would, only quieter. The URLs
// are untouched, so the test can still tell which song was asked for.

const SECONDS = 24;
const RATE = 8000;

function silentWav() {
  const samples = SECONDS * RATE;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, 'data');
  view.setUint32(40, samples, true);
  bytes.fill(128, 44);
  return Buffer.from(bytes);
}

const WAV = silentWav();

/** A 1×1 teal PNG, in place of album art from Apple's image CDN. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkkPtfDwACyQF5v0IE7wAAAABJRU5ErkJggg==',
  'base64',
);

export const stubbing = process.env.STUB_AUDIO === '1';

/** Answer this page's preview and artwork requests locally. A no-op unless STUB_AUDIO=1. */
export async function stubAudio(page) {
  if (!stubbing) return;
  await page.route(/mzstatic\.com\//, (route) =>
    route.fulfill({ status: 200, body: PNG, headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } }),
  );
  await page.route(/\.(m4a|mp3)(\?|$)/, (route) =>
    route.fulfill({
      status: 200,
      body: WAV,
      headers: {
        'content-type': 'audio/wav',
        'content-length': String(WAV.length),
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      },
    }),
  );
}
