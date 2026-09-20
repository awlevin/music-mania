import type { Mode } from '@/lib/game/types';

export type SendResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; status: number };

async function post(url: string, body?: unknown): Promise<SendResult> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, status: res.status, error: String(data.error ?? 'Something went wrong. Try again.') };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, status: 0, error: 'No connection. Check your Wi-Fi and try again.' };
  }
}

/**
 * Open a room. `heard`: song ids this screen has already played, oldest
 * first. A tv room answers with a host token; an aux or solo room seats
 * `name` straight away and answers with a player token.
 */
export function createRoom(heard: number[], mode: Mode = 'tv', name?: string): Promise<SendResult> {
  return post('/api/rooms', { heard, mode, name });
}

/** Send one action to a room. `token` is absent only for `join`. */
export function send(
  code: string,
  token: string | null,
  action: { type: string } & Record<string, unknown>,
): Promise<SendResult> {
  return post(`/api/rooms/${code}/actions`, { ...action, token });
}
