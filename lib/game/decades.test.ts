import { describe, expect, it } from 'vitest';

import catalog from '@/data/catalog.json';
import { drawSongs, fromDecades } from '@/lib/catalog';

import { ROUNDS_PER_GAME, SPARE_SONGS } from './config';
import {
  DECADE_COUNT,
  DECADES,
  decadeOf,
  defaultSetup,
  describeDecades,
  isValidSetup,
  pickDecade,
  withDifficulty,
} from './decades';
import { createRoom, reduce } from './reducer';
import type { Song } from './types';
import { viewFor } from './views';

describe('decades', () => {
  it('defaults to the most recent decades: two, four or six', () => {
    expect(defaultSetup()).toEqual({ difficulty: 'easy', decades: [2010, 2020] });
    expect(defaultSetup('medium').decades).toEqual([1990, 2000, 2010, 2020]);
    expect(defaultSetup('hard').decades).toEqual([1970, 1980, 1990, 2000, 2010, 2020]);
  });

  it('swaps a new decade in for the pick made longest ago', () => {
    let setup = defaultSetup();
    setup = pickDecade(setup, 1980);
    expect(setup.decades).toEqual([2020, 1980]);
    setup = pickDecade(setup, 1960);
    expect(setup.decades).toEqual([1980, 1960]);
    // Already in: nothing happens. Unknown: nothing happens.
    expect(pickDecade(setup, 1980)).toBe(setup);
    expect(pickDecade(setup, 1950)).toBe(setup);
    expect(isValidSetup(setup)).toBe(true);
  });

  it('keeps the picks that fit when the difficulty changes, and fills with recent decades', () => {
    const custom = pickDecade(pickDecade(defaultSetup(), 1980), 1990);
    expect(custom.decades).toEqual([1980, 1990]);
    const medium = withDifficulty(custom, 'medium');
    expect(medium).toEqual({ difficulty: 'medium', decades: [1980, 1990, 2010, 2020] });
    const easy = withDifficulty(medium, 'easy');
    expect(easy.decades).toEqual([2010, 2020]);
    expect(withDifficulty(defaultSetup(), 'hard')).toEqual(defaultSetup('hard'));
  });

  it('accepts only known decades, none twice, as many as the difficulty asks for', () => {
    expect(isValidSetup({ difficulty: 'easy', decades: [2020] })).toBe(false);
    expect(isValidSetup({ difficulty: 'easy', decades: [2020, 2020] })).toBe(false);
    expect(isValidSetup({ difficulty: 'easy', decades: [2020, 2030] })).toBe(false);
    expect(isValidSetup({ difficulty: 'hard', decades: [1960, 1970, 1980, 1990, 2000, 2010] })).toBe(true);
  });

  it('describes the decades in order, however they were picked', () => {
    expect(describeDecades([2020, 1980])).toBe('the 1980s and 2020s');
    expect(describeDecades([1990, 2000, 2010, 2020])).toBe('the 1990s, 2000s, 2010s and 2020s');
    expect(describeDecades([1970])).toBe('the 1970s');
  });

  it('has enough songs in every decade for a game on its own', () => {
    const songs = catalog as Song[];
    for (const decade of DECADES) {
      expect(fromDecades(songs, [decade]).length).toBeGreaterThanOrEqual(ROUNDS_PER_GAME + SPARE_SONGS);
    }
    expect(songs.every((s) => DECADES.includes(decadeOf(s.year)))).toBe(true);
    expect(fromDecades(songs, [1980, 1990]).every((s) => s.year >= 1980 && s.year < 2000)).toBe(true);
  });

  it('draws a game from the picked decades only', async () => {
    const { songs } = await drawSongs(ROUNDS_PER_GAME + SPARE_SONGS, [], undefined, [1960, 1970]);
    expect(songs).toHaveLength(ROUNDS_PER_GAME + SPARE_SONGS);
    expect(songs.every((s) => s.year >= 1960 && s.year < 1980)).toBe(true);
  });
});

describe('room setup', () => {
  it('lets the host change it between games, and refuses a bad mix', () => {
    let state = createRoom('ABCD', 'h', 0);
    expect(viewFor(state, { role: 'host' }, 0).setup).toEqual(defaultSetup());

    const result = reduce(state, { type: 'setup', difficulty: 'hard', decades: [1960, 1970, 1980, 1990, 2000, 2010] }, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = result.state;
    expect(state.setup.difficulty).toBe('hard');
    expect(state.setup.decades).toHaveLength(DECADE_COUNT.hard);
    expect(viewFor(state, { role: 'player', playerId: 'x' }, 1).setup).toEqual(state.setup);

    expect(reduce(state, { type: 'setup', difficulty: 'easy', decades: [2020] }, 2).ok).toBe(false);
    expect(reduce(state, { type: 'setup', difficulty: 'easy', decades: [2020, 2020] }, 2).ok).toBe(false);
  });

  it('cannot change once the songs are drawn', () => {
    let state = createRoom('ABCD', 'h', 0);
    const join = reduce(state, { type: 'join', playerId: 'p', token: 't', name: 'Ana' }, 0);
    if (!join.ok) throw new Error(join.error);
    const songs = Array.from({ length: ROUNDS_PER_GAME }, (_, i) => ({
      id: i + 1,
      title: `Song ${i}`,
      artist: `Artist ${i}`,
      album: 'Album',
      year: 2000,
      genre: 'Pop',
      artworkUrl: '',
      previewUrl: '',
    }));
    const started = reduce(join.state, { type: 'start', songs, spares: [] }, 1);
    if (!started.ok) throw new Error(started.error);
    state = started.state;
    expect(reduce(state, { type: 'setup', difficulty: 'medium', decades: [1990, 2000, 2010, 2020] }, 2).ok).toBe(false);
  });
});
