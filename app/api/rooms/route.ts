import { cleanName } from '@/lib/game/reducer';
import { dispatch, isMode, newPlayerId, newToken, openRoom, startAction } from '@/lib/realtime/rooms';

export const dynamic = 'force-dynamic';

interface Body {
  heard?: unknown;
  mode?: unknown;
  name?: unknown;
}

/**
 * Open a room. A tv room hands back the host token for the big screen. An
 * aux or solo room has no big screen: the phone that opens it is seated at
 * once as the DJ, and a solo game is started in the same breath.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Body | null;
  const heard = Array.isArray(body?.heard)
    ? body.heard.filter((id): id is number => Number.isSafeInteger(id)).slice(-1000)
    : [];
  const mode = isMode(body?.mode) ? body.mode : 'tv';

  if (mode === 'tv') {
    const room = await openRoom(heard, mode);
    return Response.json({ code: room.code, hostToken: room.hostToken });
  }

  const name = cleanName(String(body?.name ?? ''));
  if (!name) return Response.json({ error: 'Enter a name first.' }, { status: 400 });

  const room = await openRoom(heard, mode);
  const playerId = newPlayerId();
  const token = newToken();
  const seated = await dispatch(room.code, { type: 'join', playerId, token, name });
  if (!seated.ok) return Response.json({ error: seated.error }, { status: seated.status });

  if (mode === 'solo') {
    const started = await dispatch(room.code, await startAction(seated.state));
    if (!started.ok) return Response.json({ error: started.error }, { status: started.status });
  }
  return Response.json({ code: room.code, playerId, token });
}
