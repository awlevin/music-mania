// Seats survive a reload: the TV keeps its host token and each phone keeps
// its player token, per room, in localStorage.

import type { Mode } from '@/lib/game/types';

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode: the seat lasts until the tab closes. Good enough.
  }
}

function remove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {}
}

export const hostTokens = {
  get: (code: string) => read<string>(`mm:host:${code}`),
  set: (code: string, token: string) => write(`mm:host:${code}`, token),
};

export const seats = {
  get: (code: string) => read<string>(`mm:seat:${code}`),
  set: (code: string, token: string) => write(`mm:seat:${code}`, token),
  clear: (code: string) => remove(`mm:seat:${code}`),
};

/**
 * Songs this screen has played, oldest first, across every room it has
 * hosted. A new room starts from this list, so Friday's songs stay away on
 * Saturday.
 */
const HEARD_LIMIT = 600;
export const heard = {
  get: () => read<number[]>('mm:heard') ?? [],
  add: (id: number) => {
    const ids = (read<number[]>('mm:heard') ?? []).filter((x) => x !== id);
    write('mm:heard', [...ids, id].slice(-HEARD_LIMIT));
  },
};

export const lastName = {
  get: () => read<string>('mm:name') ?? '',
  set: (name: string) => write('mm:name', name),
};

/** The way this device last started a game, so the landing page opens on it. */
export const lastMode = {
  get: () => {
    const mode = read<string>('mm:mode');
    return mode === 'tv' || mode === 'aux' || mode === 'solo' ? mode : null;
  },
  set: (mode: Mode) => write('mm:mode', mode),
};

/** The best solo run on this device. */
export const soloBest = {
  get: () => read<{ score: number; at: number }>('mm:solo:best'),
  set: (score: number) => write('mm:solo:best', { score, at: Date.now() }),
};
