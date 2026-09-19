import { ImageResponse } from 'next/og';

// The same record as `icon.svg`, drawn full-bleed: iOS rounds the corners
// itself and refuses transparency.
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0e2f36',
          backgroundImage: 'radial-gradient(circle at 50% 42%, #1a5460 0%, #0e2f36 70%)',
        }}
      >
        {/* Disc */}
        <div
          style={{
            width: 152,
            height: 152,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 76,
            backgroundColor: '#14100f',
            backgroundImage: 'radial-gradient(circle at 50% 50%, #2a2220 0%, #2a2220 22%, #14100f 23%)',
            boxShadow: '0 6px 16px rgba(0,0,0,0.45)',
          }}
        >
          {/* Grooves */}
          {[132, 116, 100].map((d) => (
            <div
              key={d}
              style={{
                position: 'absolute',
                width: d,
                height: d,
                borderRadius: d / 2,
                border: '1.5px solid rgba(255,243,214,0.10)',
              }}
            />
          ))}
          {/* Label */}
          <div
            style={{
              width: 68,
              height: 68,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 34,
              backgroundColor: '#e9383f',
            }}
          >
            <div
              style={{
                position: 'absolute',
                width: 54,
                height: 54,
                borderRadius: 27,
                border: '1.5px dashed rgba(255,243,214,0.5)',
              }}
            />
            <div
              style={{
                width: 13,
                height: 13,
                borderRadius: 7,
                backgroundColor: '#08222a',
              }}
            />
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
