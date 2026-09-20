// Quick play: the whole game on one screen, for one person.
//
// Nothing here is new game logic. A solo game is an ordinary room, reduced
// by the same `reduce(state, action, now)` as a party, except that the room
// lives in the player's browser instead of the store: the one screen is
// both the television and the phone, so there is nothing to keep secret
// from anyone and no second device to keep in step.

import { MAX_POINTS, ROUNDS_PER_GAME } from '@/lib/game/config';
import { createRoom, reduce } from '@/lib/game/reducer';
import type { RoomState, Song } from '@/lib/game/types';

export const SOLO_PLAYER_ID = 'solo';
export const SOLO_PLAYER_NAME = 'You';

/** What `/api/solo` hands back: one game's songs, previews freshly resolved. */
export interface SoloDraw {
  songs: Song[];
  spares: Song[];
  finales: Song[];
}

/** A room of one, already joined, waiting in the lobby. */
export function createSoloRoom(now: number, heard: readonly number[] = []): RoomState {
  const empty = { ...createRoom('SOLO', 'solo', now), playedSongIds: [...heard] };
  const result = reduce(
    empty,
    { type: 'join', playerId: SOLO_PLAYER_ID, token: 'solo', name: SOLO_PLAYER_NAME },
    now,
  );
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

/** The most one game can pay: every song right at the first second. */
export const PERFECT_SCORE = MAX_POINTS * ROUNDS_PER_GAME;

export interface Tier {
  /** "Jukebox hero" */
  title: string;
  /** One line under it. */
  line: string;
}

/** Bragging rights, from the top down. The last one always matches. */
const TIERS: [number, Tier][] = [
  [0.9, { title: 'Walking jukebox', line: 'You could host this thing.' }],
  [0.75, { title: 'Jukebox hero', line: 'The record shop misses you.' }],
  [0.55, { title: 'Radio regular', line: 'Knows the hits. Hums the rest.' }],
  [0.35, { title: 'Casual listener', line: 'Every song is a bit familiar.' }],
  [0.15, { title: 'Background music', line: 'You were talking through most of them.' }],
  [0, { title: 'More of a podcast person', line: 'The songs will still be here tomorrow.' }],
];

/** What a score out of a full game makes you. */
export function tierFor(score: number): Tier {
  const share = score / PERFECT_SCORE;
  return TIERS.find(([floor]) => share >= floor)![1];
}

export interface PersonalBest {
  score: number;
  /** When it was set. */
  at: number;
  /** Games finished, this one included. */
  games: number;
}

/** The best after one more finished game. `previous` is null before the first. */
export function recordGame(previous: PersonalBest | null, score: number, now: number): PersonalBest {
  const games = (previous?.games ?? 0) + 1;
  if (previous && score <= previous.score) return { ...previous, games };
  return { score, at: now, games };
}
