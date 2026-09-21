// Stand-ins for Apple's CDN, for a machine that cannot reach it. Set
// FAKE_AUDIO=1 and every preview becomes thirty seconds of a soft tone, and
// every album cover a paper square. The game plays exactly as it would.

/** Thirty seconds of a soft tone, as a WAV file. */
function tone() {
  const rate = 8000;
  const samples = rate * 30;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + samples * 2, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    bytes.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 220) * 8000), 44 + i * 2);
  }
  return bytes;
}

const ART =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#ebd9ae"/><circle cx="5" cy="5" r="3" fill="#e9383f"/></svg>';

/** Route this page's preview and artwork requests to the stand-ins, when asked to. */
export async function fakeAudio(page) {
  if (!process.env.FAKE_AUDIO) return;
  const wav = tone();
  await page.route(/\.(m4a|mp3)(\?|$)/, (route) =>
    route.fulfill({ body: wav, headers: { 'content-type': 'audio/wav', 'access-control-allow-origin': '*' } }),
  );
  await page.route(/mzstatic\.com/, (route) => route.fulfill({ body: ART, contentType: 'image/svg+xml' }));
}
