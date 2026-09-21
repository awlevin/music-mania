import { pickSongs } from '@/lib/catalog';
import { ROUNDS_PER_GAME, SPARE_SONGS } from '@/lib/game/config';
import type { SoloDraw } from '@/lib/solo/local';

export const dynamic = 'force-dynamic';

/**
 * Songs for one quick-play game, drawn exactly as a room draws them. The
 * game itself runs in the browser; this is the one thing it needs a server
 * for, because the catalog and the iTunes lookup live here.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { heard?: unknown; lastFinaleId?: unknown } | null;
  const heard = Array.isArray(body?.heard)
    ? body.heard.filter((id): id is number => Number.isSafeInteger(id)).slice(-1000)
    : [];
  const lastFinaleId = Number.isSafeInteger(body?.lastFinaleId) ? (body!.lastFinaleId as number) : undefined;
  const { songs, finales } = await pickSongs(ROUNDS_PER_GAME + SPARE_SONGS, heard, lastFinaleId);
  const draw: SoloDraw = {
    songs: songs.slice(0, ROUNDS_PER_GAME),
    spares: songs.slice(ROUNDS_PER_GAME),
    finales,
  };
  return Response.json(draw, { headers: { 'cache-control': 'no-store' } });
}
