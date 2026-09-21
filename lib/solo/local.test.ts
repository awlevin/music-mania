import { describe, expect, it } from 'vitest';

import { GUESS_MS, REVEAL_MS, ROUNDS_PER_GAME } from '@/lib/game/config';
import { phaseDeadline } from '@/lib/game/deadline';
import { reduce } from '@/lib/game/reducer';
import type { Action, RoomState, Song } from '@/lib/game/types';
import { viewFor } from '@/lib/game/views';

import { createSoloRoom, PERFECT_SCORE, recordGame, SOLO_PLAYER_ID, tierFor } from './local';

function song(id: number): Song {
  return {
    id,
    title: `Song ${id}`,
    artist: `Artist ${id}`,
    album: `Album ${id}`,
    year: 1990 + id,
    genre: 'Pop',
    artworkUrl: `https://art/${id}.jpg`,
    previewUrl: `https://audio/${id}.m4a`,
  };
}

const SONGS = Array.from({ length: ROUNDS_PER_GAME }, (_, i) => song(i + 1));

function run(state: RoomState, action: Action, now: number): RoomState {
  const result = reduce(state, action, now);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe('quick play', () => {
  it('is a room of one that can start straight away', () => {
    const room = createSoloRoom(0, [7, 8]);
    expect(room.players).toHaveLength(1);
    expect(room.players[0].id).toBe(SOLO_PLAYER_ID);
    expect(room.playedSongIds).toEqual([7, 8]);
    expect(reduce(room, { type: 'start', songs: SONGS, spares: [] }, 1).ok).toBe(true);
  });

  it('reveals the moment the one player answers, and the same rules pay out', () => {
    let state = run(createSoloRoom(0), { type: 'start', songs: SONGS, spares: [] }, 0);
    state = run(state, { type: 'audio-started', roundIndex: 0 }, 1000);
    expect(phaseDeadline(viewFor(state, { role: 'host' }, 1000))).toBeGreaterThan(1000 + GUESS_MS);
    state = run(state, { type: 'answer', playerId: SOLO_PLAYER_ID, text: 'song 1' }, 4000);
    expect(state.phase).toBe('reveal');
    expect(state.players[0].score).toBe(900);
    expect(phaseDeadline(viewFor(state, { role: 'host' }, 4000))).toBe(4000 + REVEAL_MS);

    // Giving up ends the round just the same, for nothing.
    state = run(state, { type: 'next', roundIndex: 0 }, 5000);
    state = run(state, { type: 'audio-started', roundIndex: 1 }, 6000);
    state = run(state, { type: 'give-up', playerId: SOLO_PLAYER_ID }, 7000);
    expect(state.phase).toBe('reveal');
    expect(state.players[0].score).toBe(900);
  });

  it('gives the one screen both the preview and its own answer', () => {
    let state = run(createSoloRoom(0), { type: 'start', songs: SONGS, spares: [] }, 0);
    state = run(state, { type: 'audio-started', roundIndex: 0 }, 1000);
    const host = viewFor(state, { role: 'host' }, 1000);
    expect(host.round?.previewUrl).toBe('https://audio/1.m4a');
    state = run(state, { type: 'answer', playerId: SOLO_PLAYER_ID, text: 'nope' }, 2000);
    const player = viewFor(state, { role: 'player', playerId: SOLO_PLAYER_ID }, 2000);
    expect(player.you?.answer).toEqual({ text: 'nope', elapsedMs: 1000, gaveUp: false });
  });

  it('has no deadline while nothing is running', () => {
    const room = createSoloRoom(0);
    expect(phaseDeadline(viewFor(room, { role: 'host' }, 0))).toBeNull();
    const started = run(room, { type: 'start', songs: SONGS, spares: [] }, 0);
    expect(phaseDeadline(viewFor(started, { role: 'host' }, 0))).toBeNull();
  });

  it('ranks a score from podcast person to walking jukebox', () => {
    expect(tierFor(0).title).toBe('More of a podcast person');
    expect(tierFor(PERFECT_SCORE).title).toBe('Walking jukebox');
    const titles = [0, 2000, 4000, 6000, 8000, 10000].map((s) => tierFor(s).title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('keeps the best score and counts every game', () => {
    const first = recordGame(null, 4200, 10);
    expect(first).toEqual({ score: 4200, at: 10, games: 1 });
    const worse = recordGame(first, 3000, 20);
    expect(worse).toEqual({ score: 4200, at: 10, games: 2 });
    const better = recordGame(worse, 6100, 30);
    expect(better).toEqual({ score: 6100, at: 30, games: 3 });
    // Equalling the best does not reset when it was set.
    expect(recordGame(better, 6100, 40)).toEqual({ score: 6100, at: 30, games: 4 });
  });
});
