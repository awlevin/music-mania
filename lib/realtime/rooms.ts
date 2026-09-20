import { randomBytes, randomInt } from 'node:crypto';

import { lobbySong, pickSongs } from '@/lib/catalog';
import { ROUNDS_PER_GAME, SPARE_SONGS } from '@/lib/game/config';
import { createRoom, reduce } from '@/lib/game/reducer';
import type { Action, Mode, RoomState } from '@/lib/game/types';
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

export function isMode(raw: unknown): raw is Mode {
  return raw === 'tv' || raw === 'aux' || raw === 'solo';
}

/** `heard`: songs the hosting screen has played before, oldest first. */
export async function openRoom(heard: number[] = [], mode: Mode = 'tv'): Promise<RoomState> {
  const store = getStore();
  // A solo game has no lobby, so nothing plays in it.
  const lobby = mode === 'solo' ? null : await lobbySong();
  for (let attempt = 0; attempt < 20; attempt++) {
    const state = {
      ...createRoom(newCode(), newToken(), Date.now(), lobby?.previewUrl ?? null, mode),
      playedSongIds: heard,
    };
    if (await store.create(state)) return state;
  }
  throw new Error('Could not find a free room code.');
}

/** Draw the songs for a new game in this room: ten questions, spares, and the finale. */
export async function startAction(room: RoomState): Promise<Action> {
  const { songs, finales } = await pickSongs(
    ROUNDS_PER_GAME + SPARE_SONGS,
    room.playedSongIds,
    room.finales?.[0]?.id,
  );
  return {
    type: 'start',
    songs: songs.slice(0, ROUNDS_PER_GAME),
    spares: songs.slice(ROUNDS_PER_GAME),
    finales,
  };
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
