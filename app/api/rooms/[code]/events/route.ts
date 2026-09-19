// One long-lived event stream per screen. Each message is the full view for
// that screen, so a dropped connection costs nothing: EventSource reconnects
// by itself and the first message puts the screen right again.

import type { RoomState } from '@/lib/game/types';
import { viewFor } from '@/lib/game/views';
import { identify, normalizeCode } from '@/lib/realtime/rooms';
import { getStore } from '@/lib/realtime/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** End the stream ourselves, cleanly, before the platform cuts it. */
const STREAM_MS = 270_000;
const HEARTBEAT_MS = 15_000;

export async function GET(
  request: Request,
  ctx: RouteContext<'/api/rooms/[code]/events'>,
): Promise<Response> {
  const code = normalizeCode((await ctx.params).code);
  const token = new URL(request.url).searchParams.get('token');
  const store = getStore();

  const initial = await store.get(code);
  if (!initial) return Response.json({ error: 'That room has closed.' }, { status: 404 });
  if (!identify(initial, token)) {
    return Response.json({ error: 'You are not in this room.' }, { status: 401 });
  }

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let lastVersion = 0;

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      const send = (state: RoomState) => {
        if (state.version <= lastVersion) return;
        // Identify again on every state: a removed player's stream must end.
        const viewer = identify(state, token);
        if (!viewer) {
          write(`event: removed\ndata: {}\n\n`);
          cleanup();
          return;
        }
        lastVersion = state.version;
        write(`data: ${JSON.stringify(viewFor(state, viewer, Date.now()))}\n\n`);
      };

      // Subscribe first, then snapshot: nothing can slip between the two.
      const unsubscribe = await store.subscribe(code, send);
      const heartbeat = setInterval(() => write(`: keep-alive\n\n`), HEARTBEAT_MS);
      const deadline = setTimeout(() => cleanup(), STREAM_MS);

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(deadline);
        unsubscribe();
        try {
          controller.close();
        } catch {}
      };
      request.signal.addEventListener('abort', cleanup);

      write(`retry: 1000\n\n`);
      const snapshot = await store.get(code);
      if (snapshot) send(snapshot);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
