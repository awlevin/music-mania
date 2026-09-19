import type { Metadata, Viewport } from 'next';
import { Barlow, Barlow_Condensed, Shrikhand } from 'next/font/google';

import './globals.css';

// Shrikhand is the record-label wordmark. Barlow Condensed is the typed
// lettering of a jukebox title strip. Barlow carries everything else.
const display = Shrikhand({ weight: '400', subsets: ['latin'], variable: '--font-display' });
const strip = Barlow_Condensed({
  weight: ['500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-strip',
});
const body = Barlow({ weight: ['400', '500', '600'], subsets: ['latin'], variable: '--font-body' });

export const metadata: Metadata = {
  title: 'Music Mania',
  description: 'One screen plays the song. Everyone races to name it from their phone.',
};

export const viewport: Viewport = {
  themeColor: '#0e2f36',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${display.variable} ${strip.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
