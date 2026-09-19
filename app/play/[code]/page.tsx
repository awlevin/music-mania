import { PlayScreen } from '@/components/play/PlayScreen';
import { normalizeCode } from '@/lib/realtime/rooms';

export default async function PlayPage({ params }: PageProps<'/play/[code]'>) {
  const { code } = await params;
  return <PlayScreen code={normalizeCode(code)} />;
}
