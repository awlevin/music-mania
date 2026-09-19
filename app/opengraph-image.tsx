import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ImageResponse } from 'next/og';

// The share card: the jukebox booth, the wordmark, one title strip and the
// record. `twitter-image.tsx` re-exports all of this.
export const alt = 'Music Mania — name the song before your friends do';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Read as plain files, not through next/font: `next/og` needs the bytes, and
// the paths stay literal so the build traces them into the deployment.
const [shrikhand, stripSemiBold, stripBold] = await Promise.all([
  readFile(join(process.cwd(), 'assets/fonts/Shrikhand-Regular.ttf')),
  readFile(join(process.cwd(), 'assets/fonts/BarlowCondensed-SemiBold.ttf')),
  readFile(join(process.cwd(), 'assets/fonts/BarlowCondensed-Bold.ttf')),
]);

const BOOTH_DEEP = '#08222a';
const PAPER = '#fff3d6';
const INK = '#241713';
const CHERRY = '#e9383f';
const BUTTER = '#ffc845';
const CHROME = '#b9cdd0';

/**
 * The rays the music throws off the edge of the record, frozen on one frame —
 * the same drawing `components/host/Halo.tsx` animates, plus the timer ring.
 */
function haloDataUrl(box: number): string {
  const c = box / 2;
  const inner = box * 0.404;
  const reach = box * 0.092;
  const bars = 72;
  let rays = '';
  for (let i = 0; i < bars; i++) {
    // Mirrored, the way the live halo mirrors the spectrum: bass at the top.
    const half = i < bars / 2 ? i : bars - 1 - i;
    const level = Math.abs(Math.sin(half * 0.8) * 0.55 + Math.sin(half * 0.27) * 0.45);
    const length = reach * (0.18 + Math.pow(level, 1.3));
    const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
    const x1 = c + Math.cos(angle) * inner;
    const y1 = c + Math.sin(angle) * inner;
    const x2 = c + Math.cos(angle) * (inner + length);
    const y2 = c + Math.sin(angle) * (inner + length);
    const alpha = (0.35 + level * 0.65).toFixed(2);
    rays += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke-opacity="${alpha}"/>`;
  }
  // The countdown ring, a little under two thirds run down.
  const r = box * 0.376;
  const circumference = 2 * Math.PI * r;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}">` +
    `<g stroke="${CHERRY}" stroke-width="${(box * 0.009).toFixed(2)}" stroke-linecap="round">${rays}</g>` +
    `<circle cx="${c}" cy="${c}" r="${r.toFixed(1)}" fill="none" stroke="${CHERRY}" stroke-width="${(box * 0.011).toFixed(2)}" stroke-linecap="round" stroke-dasharray="${(circumference * 0.66).toFixed(1)} ${circumference.toFixed(1)}" transform="rotate(-90 ${c} ${c})"/>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const DISC = 450;
const HALO = Math.round(DISC * 1.38);

function stripLine(text: string) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 86,
        color: INK,
        fontFamily: 'Barlow Condensed',
        fontWeight: 600,
        fontSize: 52,
        letterSpacing: 1,
      }}
    >
      {text}
    </div>
  );
}

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          position: 'relative',
          padding: '0 76px',
          backgroundColor: BOOTH_DEEP,
          backgroundImage:
            'radial-gradient(circle at 30% 48%, #1d5a69 0%, #113a45 42%, #08222a 76%)',
        }}
      >
        {/* The record, hanging off the right edge the way the landing page does. */}
        <div
          style={{
            position: 'absolute',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            top: (630 - HALO) / 2,
            left: 1200 - HALO + 96,
            width: HALO,
            height: HALO,
          }}
        >
          {/* satori draws SVG through <img>, not as an element. */}
          <img src={haloDataUrl(HALO)} width={HALO} height={HALO} alt="" />
          <div
            style={{
              position: 'absolute',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: DISC,
              height: DISC,
              borderRadius: DISC / 2,
              backgroundColor: '#14100f',
              backgroundImage:
                'radial-gradient(circle at 50% 50%, #332b28 0%, #2a2220 30%, #14100f 34%, #14100f 100%)',
              boxShadow: '0 26px 70px rgba(0,0,0,0.55)',
            }}
          >
            {[412, 370, 328, 286].map((d) => (
              <div
                key={d}
                style={{
                  position: 'absolute',
                  width: d,
                  height: d,
                  borderRadius: d / 2,
                  border: '2px solid rgba(255,243,214,0.055)',
                }}
              />
            ))}
            {/* The label: a question, because the song is the question. */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 172,
                height: 172,
                borderRadius: 86,
                backgroundColor: CHERRY,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  width: 145,
                  height: 145,
                  borderRadius: 73,
                  border: '2px dashed rgba(255,243,214,0.45)',
                }}
              />
              <div
                style={{
                  display: 'flex',
                  marginTop: -30,
                  color: PAPER,
                  fontFamily: 'Shrikhand',
                  fontSize: 78,
                  lineHeight: 1,
                }}
              >
                ?
              </div>
              <div
                style={{
                  position: 'absolute',
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  backgroundColor: BOOTH_DEEP,
                }}
              />
            </div>
          </div>
        </div>

        {/* The words. */}
        <div style={{ display: 'flex', flexDirection: 'column', width: 660 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              marginBottom: 46,
              marginLeft: 6,
              transform: 'rotate(-3deg)',
              fontFamily: 'Shrikhand',
              fontSize: 104,
              lineHeight: 0.86,
              color: PAPER,
              textShadow: '6px 6px 0 #e9383f',
            }}
          >
            <div style={{ display: 'flex' }}>Music</div>
            <div style={{ display: 'flex', marginLeft: 57, color: BUTTER }}>Mania</div>
          </div>

          {/* One jukebox title strip, carrying the pitch. */}
          <div
            style={{
              display: 'flex',
              padding: 12,
              borderRadius: 18,
              backgroundColor: PAPER,
              boxShadow: '0 22px 46px rgba(0,0,0,0.38)',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                width: '100%',
                border: `5px solid ${CHERRY}`,
                borderRadius: 11,
              }}
            >
              {stripLine('NAME THE SONG')}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: 42,
                  backgroundColor: CHERRY,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    padding: '2px 26px',
                    borderRadius: 99,
                    backgroundColor: PAPER,
                    color: INK,
                    fontFamily: 'Barlow Condensed',
                    fontWeight: 700,
                    fontSize: 22,
                    letterSpacing: 5,
                  }}
                >
                  NOW PLAYING
                </div>
              </div>
              {stripLine('BEFORE YOUR FRIENDS DO')}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              marginTop: 32,
              marginLeft: 6,
              color: CHROME,
              fontFamily: 'Barlow Condensed',
              fontWeight: 600,
              fontSize: 28,
              letterSpacing: 3,
              whiteSpace: 'nowrap',
            }}
          >
            ONE BIG SCREEN · EVERYONE&apos;S PHONES · 10 SONGS
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Shrikhand', data: shrikhand, weight: 400, style: 'normal' },
        { name: 'Barlow Condensed', data: stripSemiBold, weight: 600, style: 'normal' },
        { name: 'Barlow Condensed', data: stripBold, weight: 700, style: 'normal' },
      ],
    },
  );
}
