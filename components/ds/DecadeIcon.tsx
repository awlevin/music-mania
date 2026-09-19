// How each decade listened. Line icons on a 24-unit grid, drawn to read at
// the size of a chip on a television across the room.

import type { ReactNode } from 'react';

const ICONS: Record<number, { name: string; shape: ReactNode }> = {
  1960: {
    name: 'transistor radio',
    shape: (
      <>
        <rect x="3" y="8.5" width="18" height="12" rx="2" />
        <path d="M17 8.5l4-5" />
        <circle cx="16.5" cy="14.5" r="2.4" />
        <path d="M6.2 12.5h4.6M6.2 14.5h4.6M6.2 16.5h4.6" />
      </>
    ),
  },
  1970: {
    name: 'vinyl record',
    shape: (
      <>
        <circle cx="12" cy="12" r="9.2" />
        <circle cx="12" cy="12" r="3" />
        <circle cx="12" cy="12" r="0.5" fill="currentColor" />
        <path d="M12 5.8a6.2 6.2 0 0 1 6.2 6.2" />
      </>
    ),
  },
  1980: {
    name: 'cassette tape',
    shape: (
      <>
        <rect x="2.5" y="5" width="19" height="14" rx="2" />
        <circle cx="8.5" cy="11.5" r="2.1" />
        <circle cx="15.5" cy="11.5" r="2.1" />
        <path d="M10.6 11.5h2.8M7 19l1-3.2h8l1 3.2" />
      </>
    ),
  },
  1990: {
    name: 'compact disc',
    shape: (
      <>
        <circle cx="12" cy="12" r="9.2" />
        <circle cx="12" cy="12" r="2.4" />
        <path d="M5.6 9.6a6.8 6.8 0 0 1 4-4M18.4 14.4a6.8 6.8 0 0 1-4 4" />
      </>
    ),
  },
  2000: {
    name: 'click-wheel music player',
    shape: (
      <>
        <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
        <rect x="8.5" y="5" width="7" height="5" rx="0.8" />
        <circle cx="12" cy="15.6" r="3.2" />
        <circle cx="12" cy="15.6" r="0.6" fill="currentColor" />
      </>
    ),
  },
  2010: {
    name: 'smartphone',
    shape: (
      <>
        <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
        <path d="M10.5 5.3h3" />
        <path d="M13.8 9.2v5.4" />
        <circle cx="12.2" cy="14.6" r="1.6" />
        <path d="M13.8 9.2l2.4-.8" />
      </>
    ),
  },
  2020: {
    name: 'wireless earbuds',
    shape: (
      <>
        <circle cx="7.5" cy="8.5" r="3.2" />
        <path d="M6.6 11.6L5.4 18.5" />
        <circle cx="16.5" cy="8.5" r="3.2" />
        <path d="M17.4 11.6l1.2 6.9" />
      </>
    ),
  },
};

/** What a decade's music came out of. Decorative: the year text beside it does the naming. */
export function DecadeIcon({ decade, className = '' }: { decade: number; className?: string }) {
  const icon = ICONS[decade];
  if (!icon) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <title>{icon.name}</title>
      {icon.shape}
    </svg>
  );
}
