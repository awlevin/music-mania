import type { Action } from '@/lib/game/types';
import { playsAudio } from '@/lib/game/views';
import { dispatch, identify, newPlayerId, newToken, normalizeCode, startAction } from '@/lib/realtime/rooms';
import { getStore } from '@/lib/realtime/store';

export const dynamic = 'force-dynamic';

const refuse = (status: number, error: string) => Response.json({ error }, { status });

interface Body {
  type?: string;
  token?: string;
  name?: string;
  text?: string;
  playerId?: string;
  roundIndex?: number;
}

export async function POST(
  request: Request,
  ctx: RouteContext<'/api/rooms/[code]/actions'>,
): Promise<Response> {
  const code = normalizeCode((await ctx.params).code);
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.type) return refuse(400, 'Missing action.');

  if (body.type === 'join') {
    const playerId = newPlayerId();
    const token = newToken();
    const result = await dispatch(code, {
      type: 'join',
      playerId,
      token,
      name: String(body.name ?? ''),
    });
    if (!result.ok) return refuse(result.status, result.error);
    return Response.json({ playerId, token });
  }

  const room = await getStore().get(code);
  if (!room) return refuse(404, 'That room has closed.');
  const viewer = identify(room, body.token ?? null);
  if (!viewer) return refuse(401, 'You are not in this room.');

  const roundIndex = Number(body.roundIndex);
  let action: Action | null = null;

  if (body.type === 'tick') action = { type: 'tick' };
  if (body.type === 'next') action = { type: 'next', roundIndex };
  if (body.type === 'resume') action = { type: 'resume' };
  if (body.type === 'pause') {
    const by =
      viewer.role === 'player'
        ? (room.players.find((p) => p.id === viewer.playerId)?.name ?? 'Someone')
        : 'The host';
    action = { type: 'pause', by };
  }

  // The TV can start a game, and so can the first player, from their phone.
  const leader = viewer.role === 'player' && room.players[0]?.id === viewer.playerId;
  if (body.type === 'start' && (viewer.role === 'host' || leader)) action = await startAction(room);

  // Whichever device plays the music says when it is playing.
  if (playsAudio(room, viewer)) {
    if (body.type === 'audio-started') action = { type: 'audio-started', roundIndex };
    if (body.type === 'audio-failed') action = { type: 'audio-failed', roundIndex };
  }

  if (viewer.role === 'host') {
    if (body.type === 'remove-player' && body.playerId) {
      action = { type: 'remove-player', playerId: body.playerId };
    }
  } else {
    const { playerId } = viewer;
    if (body.type === 'answer') action = { type: 'answer', playerId, text: String(body.text ?? '') };
    if (body.type === 'give-up') action = { type: 'give-up', playerId };
    if (body.type === 'rename') action = { type: 'rename', playerId, name: String(body.name ?? '') };
    if (body.type === 'leave') action = { type: 'remove-player', playerId };
    // The DJ can hand the aux to anyone; the leader can take it back from a phone that went quiet.
    if (body.type === 'pass-aux' && body.playerId && (room.dj === playerId || leader)) {
      action = { type: 'pass-aux', playerId: body.playerId };
    }
  }

  if (!action) return refuse(403, 'That action is not available to you.');
  const result = await dispatch(code, action);
  if (!result.ok) return refuse(result.status, result.error);
  return Response.json({ ok: true });
}
