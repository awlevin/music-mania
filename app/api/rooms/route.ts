import { openRoom } from '@/lib/realtime/rooms';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { heard?: unknown } | null;
  const heard = Array.isArray(body?.heard)
    ? body.heard.filter((id): id is number => Number.isSafeInteger(id)).slice(-1000)
    : [];
  const room = await openRoom(heard);
  return Response.json({ code: room.code, hostToken: room.hostToken });
}
