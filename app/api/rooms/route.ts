import { openRoom } from '@/lib/realtime/rooms';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  const room = await openRoom();
  return Response.json({ code: room.code, hostToken: room.hostToken });
}
