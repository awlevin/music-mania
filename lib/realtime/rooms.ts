import { randomBytes, randomInt } from 'node:crypto';

import { lobbySong } from '@/lib/catalog';
import { createRoom, reduce } from '@/lib/game/reducer';
import type { Action, RoomState } from '@/lib/game/types';
import type { Viewer } from '@/lib/game/views';

import { getStore } from './store';

// No I, O, or U: nothing that reads as a digit on a TV across the room, and
// far fewer ways to spell something rude.
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTVWXYZ';
const CODE_LENGTH = 4;

export function newToken(): string {
  return randomBytes(18).toString('base64url');
}

export function newPlayerId(): string {
  return randomBytes(6).toString('base64url');
}

function newCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_LETTERS[randomInt(CODE_LETTERS.length)];
  return code;
}

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, CODE_LENGTH);
}

export async function openRoom(): Promise<RoomState> {
  const store = getStore();
  const lobby = await lobbySong();
  for (let attempt = 0; attempt < 20; attempt++) {
    const state = createRoom(newCode(), newToken(), Date.now(), lobby.previewUrl);
    if (await store.create(state)) return state;
  }
  throw new Error('Could not find a free room code.');
}

export type DispatchResult =
  | { ok: true; state: RoomState }
  | { ok: false; status: number; error: string };

/**
 * Read, reduce, compare-and-set. When another request wins the race, reduce
 * again on top of what it wrote. Two phones locking in within the same
 * millisecond both land.
 */
export async function dispatch(code: string, action: Action): Promise<DispatchResult> {
  const store = getStore();
  for (let attempt = 0; attempt < 10; attempt++) {
    const current = await store.get(code);
    if (!current) return { ok: false, status: 404, error: 'That room has closed.' };

    const result = reduce(current, action, Date.now());
    if (!result.ok) return { ok: false, status: 409, error: result.error };
    if (result.state === current) return { ok: true, state: current };
    if (await store.compareAndSet(current.version, result.state)) return result;
  }
  return { ok: false, status: 503, error: 'The room is busy. Try again.' };
}

/** Who a token belongs to in this room, if anyone. */
export function identify(state: RoomState, token: string | null): Viewer | null {
  if (!token) return null;
  if (token === state.hostToken) return { role: 'host' };
  const player = state.players.find((p) => p.token === token);
  return player ? { role: 'player', playerId: player.id } : null;
}
