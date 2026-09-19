import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Music Mania',
    short_name: 'Music Mania',
    description: 'One screen plays the song. Everyone races to name it from their phone.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#08222a',
    theme_color: '#0e2f36',
    categories: ['games', 'music', 'entertainment'],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
