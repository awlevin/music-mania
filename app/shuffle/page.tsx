import type { Metadata } from 'next';

import { ShufflePreview } from '@/components/shuffle/ShufflePreview';
import { drawGame } from '@/lib/catalog/preview';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Shuffle preview',
  description: 'Draw game after game from the catalog and see which songs come up.',
  robots: { index: false },
};

export default async function ShufflePage() {
  return <ShufflePreview initial={await drawGame()} />;
}
