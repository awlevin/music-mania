import type { Metadata } from 'next';

import { SoloScreen } from '@/components/solo/SoloScreen';

export const metadata: Metadata = {
  title: 'Quick play',
  description: 'Ten songs, fifteen seconds each, on this screen. No room, no phones, just you.',
};

export default function SoloPage() {
  return <SoloScreen />;
}
