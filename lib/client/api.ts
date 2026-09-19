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

/** `heard`: song ids this screen has already played, oldest first. */
export function createRoom(heard: number[]): Promise<SendResult> {
  return post('/api/rooms', { heard });
}

/** Send one action to a room. `token` is absent only for `join`. */
export function send(
  code: string,
  token: string | null,
  action: { type: string } & Record<string, unknown>,
): Promise<SendResult> {
  return post(`/api/rooms/${code}/actions`, { ...action, token });
}
