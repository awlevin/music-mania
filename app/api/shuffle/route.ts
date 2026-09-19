import { drawGame } from '@/lib/catalog/preview';

export const dynamic = 'force-dynamic';

/** One game's draw, as `/shuffle` shows it. Every call is a fresh shuffle. */
export async function GET(): Promise<Response> {
  return Response.json(await drawGame(), { headers: { 'cache-control': 'no-store' } });
}
