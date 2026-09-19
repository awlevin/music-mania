import { HostScreen } from '@/components/host/HostScreen';
import { normalizeCode } from '@/lib/realtime/rooms';

export default async function HostPage({ params }: PageProps<'/host/[code]'>) {
  const { code } = await params;
  return <HostScreen code={normalizeCode(code)} />;
}
