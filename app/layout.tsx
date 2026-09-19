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

const SITE = 'https://music-mania-three.vercel.app';
const PITCH = 'One screen plays the song. Everyone races to name it from their phone.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: 'Music Mania — name that tune, with your friends',
    template: '%s · Music Mania',
  },
  description: PITCH,
  applicationName: 'Music Mania',
  authors: [{ name: 'Aaron Levin', url: 'https://github.com/awlevin' }],
  creator: 'Aaron Levin',
  keywords: [
    'name that tune',
    'party game',
    'music quiz',
    'music trivia',
    'guess the song',
    'phone controller',
    'living room game',
  ],
  openGraph: {
    type: 'website',
    siteName: 'Music Mania',
    url: SITE,
    title: 'Music Mania — name that tune, with your friends',
    description: PITCH,
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Music Mania — name that tune, with your friends',
    description: PITCH,
  },
};

export const viewport: Viewport = {
  themeColor: '#0e2f36',
  colorScheme: 'dark',
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
