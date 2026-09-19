import { addFeedback, allow, listFeedback, toPublic } from '@/lib/feedback/store';
import { type Feedback, SONG_ISSUES, type SongIssue } from '@/lib/feedback/types';
import { identify, normalizeCode } from '@/lib/realtime/rooms';
import { getStore } from '@/lib/realtime/store';

import { isAdmin } from './admin';

export const dynamic = 'force-dynamic';

const MAX_TEXT = 1000;

interface Body {
  kind?: string;
  issue?: string;
  text?: string;
  code?: string;
  token?: string;
}

/** Everything, for whoever works the queue; the public fields, for everyone else. */
export async function GET(request: Request): Promise<Response> {
  const items = await listFeedback();
  return Response.json({ items: isAdmin(request) ? items : items.map(toPublic) });
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body) return Response.json({ error: 'Nothing was sent.' }, { status: 400 });

  const kind = body.kind === 'song' ? 'song' : 'note';
  const issue = kind === 'song' && body.issue && body.issue in SONG_ISSUES ? (body.issue as SongIssue) : undefined;
  const text = String(body.text ?? '').trim().slice(0, MAX_TEXT);
  if (kind === 'note' && !text) return Response.json({ error: 'Write a few words first.' }, { status: 400 });
  if (kind === 'song' && !issue) return Response.json({ error: 'Pick what is wrong with the song.' }, { status: 400 });

  const who = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!(await allow(who))) {
    return Response.json({ error: 'That is a lot of feedback. Try again in an hour.' }, { status: 429 });
  }

  // The context comes from the room itself, not from the phone: it cannot be
  // faked, and the sender never has to describe where they were.
  const context: Feedback['context'] = {
    from: 'visitor',
    userAgent: request.headers.get('user-agent') ?? undefined,
    appVersion: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
  };
  let song: Feedback['song'];

  const room = body.code ? await getStore().get(normalizeCode(body.code)) : null;
  const viewer = room ? identify(room, body.token ?? null) : null;
  if (room && viewer) {
    const round = room.rounds[room.roundIndex];
    context.from = viewer.role;
    context.room = room.code;
    context.phase = room.phase;
    if (viewer.role === 'player') {
      context.playerName = room.players.find((p) => p.id === viewer.playerId)?.name;
      context.answer = round?.answers[viewer.playerId]?.text;
    }
    if (round && room.phase !== 'lobby') {
      context.roundIndex = room.roundIndex;
      context.questionKind = round.kind;
      // Only a song that has been revealed can be named back to a player.
      if (room.phase === 'reveal' || room.phase === 'finished') {
        const { id, title, artist, album, year } = round.song;
        song = { id, title, artist, album, year };
      }
    }
  }
  if (kind === 'song' && !song) {
    return Response.json({ error: 'There is no song on screen to report.' }, { status: 409 });
  }

  const item = await addFeedback({ kind, issue, text, song, context });
  return Response.json({ id: item.id });
}
