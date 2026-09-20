import { describe, expect, it } from 'vitest';

import { chooseFinales, chooseReprises, chooseSongs } from '@/lib/catalog';

import { ANSWER_GRACE_MS, GUESS_MS, REVEAL_MS, ROUND_KINDS, ROUNDS_PER_GAME } from './config';
import { leadArtist, matchesArtist, matchesText, parseYear } from './match';
import { createRoom, reduce } from './reducer';
import { knowers, pickReprises } from './reprise';
import { grade, speedPoints, yearShare } from './score';
import type { Action, RoomState, Round, Song } from './types';
import { viewFor } from './views';

function song(id: number, over: Partial<Song> = {}): Song {
  return {
    id,
    title: `Song ${id}`,
    artist: `Artist ${id}`,
    album: `Album ${id}`,
    year: 1990 + id,
    genre: 'Pop',
    artworkUrl: `https://art/${id}.jpg`,
    previewUrl: `https://audio/${id}.m4a`,
    ...over,
  };
}

const SONGS = Array.from({ length: ROUNDS_PER_GAME }, (_, i) => song(i + 1));
const SPARES = [song(101), song(102)];

function run(state: RoomState, action: Action, now: number): RoomState {
  const result = reduce(state, action, now);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function lobbyWith(names: string[]): RoomState {
  let state = createRoom('ABCD', 'host-token', 0);
  names.forEach((name, i) => {
    state = run(state, { type: 'join', playerId: `p${i}`, token: `t${i}`, name }, 0);
  });
  return state;
}

function guessing(names: string[], now = 1000): RoomState {
  let state = lobbyWith(names);
  state = run(state, { type: 'start', songs: SONGS, spares: SPARES }, now);
  return run(state, { type: 'audio-started', roundIndex: 0 }, now);
}

describe('matching', () => {
  it('forgives case, punctuation, accents and a dropped article', () => {
    expect(matchesText('mr brightside', 'Mr. Brightside')).toBe(true);
    expect(matchesText('dont stop believing', "Don't Stop Believin'")).toBe(true);
    expect(matchesText('beyonce', 'Beyoncé')).toBe(true);
    expect(matchesArtist('killers', 'The Killers')).toBe(true);
  });

  it('forgives typos in proportion to length', () => {
    expect(matchesText('bohemian rapsody', 'Bohemian Rhapsody')).toBe(true);
    expect(matchesText('help', 'Hell')).toBe(false);
    expect(matchesText('yellow submarine', 'Yesterday')).toBe(false);
  });

  it('ignores edition and featuring decorations', () => {
    expect(matchesText('umbrella', 'Umbrella (feat. JAY-Z)')).toBe(true);
    expect(matchesText('come together', 'Come Together - Remastered 2009')).toBe(true);
    expect(matchesText('i cant get no satisfaction', "(I Can't Get No) Satisfaction")).toBe(true);
    expect(matchesText('satisfaction', "(I Can't Get No) Satisfaction")).toBe(true);
  });

  it('accepts any one credited artist', () => {
    expect(matchesArtist('david bowie', 'Queen & David Bowie')).toBe(true);
    expect(matchesArtist('queen', 'Queen & David Bowie')).toBe(true);
    expect(matchesArtist('simon and garfunkel', 'Simon & Garfunkel')).toBe(true);
    expect(matchesArtist('prince', 'Queen & David Bowie')).toBe(false);
  });

  it('parses only four-digit years', () => {
    expect(parseYear(' 1984 ')).toBe(1984);
    expect(parseYear('84')).toBeNull();
    expect(parseYear('nineteen')).toBeNull();
  });

  it('names the lead artist of a credit', () => {
    expect(leadArtist('Queen & David Bowie')).toBe('queen');
    expect(leadArtist('Rihanna feat. JAY-Z')).toBe('rihanna');
    expect(leadArtist('The Beatles')).toBe('the beatles');
  });
});

describe('scoring', () => {
  it('pays more for speed', () => {
    expect(speedPoints(0)).toBe(1000);
    expect(speedPoints(GUESS_MS)).toBe(500);
    expect(speedPoints(3000)).toBeGreaterThan(speedPoints(9000));
  });

  it('pays a year guess by closeness, falling away fast past a few years', () => {
    const shares = [0, 1, 2, 3, 4, 5, 6, 7].map(yearShare);
    expect(shares[0]).toBe(1);
    for (let d = 1; d < shares.length; d++) expect(shares[d]).toBeLessThan(shares[d - 1]);
    // Each extra year costs more than the one before, up to the knee of the curve.
    expect(shares[0] - shares[1]).toBeLessThan(shares[1] - shares[2]);
    expect(shares[1] - shares[2]).toBeLessThan(shares[2] - shares[3]);
    expect(shares[3]).toBeGreaterThan(0.4);
    expect(shares[5]).toBeLessThan(0.15);
    expect(shares[7]).toBe(0);
  });

  it('pays part of the pot for a near-miss year', () => {
    const s = song(1, { year: 1984 });
    expect(grade('year', s, '1984', 0)).toMatchObject({ correct: true, points: 1000, yearsOff: 0 });
    expect(grade('year', s, '1985', 0)).toMatchObject({ correct: false, points: 923, yearsOff: 1 });
    expect(grade('year', s, '1982', 0)).toMatchObject({ correct: false, points: 726 });
    expect(grade('year', s, '1981', 0).points).toBe(487);
    expect(grade('year', s, '1989', 0).points).toBe(135);
    expect(grade('year', s, '1992', 0).points).toBe(0);
    expect(grade('year', s, 'dunno', 0).points).toBe(0);
  });
});

describe('room', () => {
  it('refuses duplicate names and empty rooms', () => {
    const state = lobbyWith(['Ana']);
    expect(reduce(state, { type: 'join', playerId: 'x', token: 'y', name: ' ana ' }, 0).ok).toBe(false);
    const empty = createRoom('ABCD', 'h', 0);
    expect(reduce(empty, { type: 'start', songs: SONGS, spares: [] }, 0).ok).toBe(false);
  });

  it('starts the clock only when the host reports audio', () => {
    let state = lobbyWith(['Ana']);
    state = run(state, { type: 'start', songs: SONGS, spares: SPARES }, 500);
    expect(state.phase).toBe('loading');
    expect(reduce(state, { type: 'answer', playerId: 'p0', text: 'x' }, 600).ok).toBe(false);
    state = run(state, { type: 'audio-started', roundIndex: 0 }, 2000);
    expect(state.phase).toBe('guessing');
    expect(state.rounds[0].guessStartedAt).toBe(2000);
  });

  it('reveals as soon as everyone has answered, and scores by speed', () => {
    let state = guessing(['Ana', 'Ben']);
    state = run(state, { type: 'answer', playerId: 'p0', text: 'song 1' }, 1000 + 3000);
    expect(state.phase).toBe('guessing');
    expect(state.players[0].score).toBe(0);
    state = run(state, { type: 'answer', playerId: 'p1', text: 'wrong' }, 1000 + 6000);
    expect(state.phase).toBe('reveal');
    expect(state.players[0].score).toBe(900);
    expect(state.players[1].score).toBe(0);
  });

  it('counts giving up as done, publicly, for no points', () => {
    let state = guessing(['Ana', 'Ben']);
    state = run(state, { type: 'give-up', playerId: 'p1' }, 4000);
    const host = viewFor(state, { role: 'host' }, 4000);
    expect(host.players[1]).toMatchObject({ answered: true, gaveUp: true });
    expect(reduce(state, { type: 'answer', playerId: 'p1', text: 'song 1' }, 4500).ok).toBe(false);
    state = run(state, { type: 'answer', playerId: 'p0', text: 'song 1' }, 5000);
    expect(state.phase).toBe('reveal');
    expect(state.players[1].score).toBe(0);
  });

  it('stops every clock while paused, and gives the time back on resume', () => {
    let state = guessing(['Ana', 'Ben']);
    state = run(state, { type: 'pause', by: 'Ben' }, 1000 + 4000);
    expect(viewFor(state, { role: 'host' }, 0).pause).toEqual({ at: 5000, by: 'Ben' });

    // An hour passes. Nothing times out, and nobody can answer into the silence.
    const later = 5000 + 3_600_000;
    expect(run(state, { type: 'tick' }, later)).toBe(state);
    expect(reduce(state, { type: 'answer', playerId: 'p0', text: 'song 1' }, later).ok).toBe(false);

    state = run(state, { type: 'resume' }, later);
    expect(state.pause).toBeNull();
    // Ana answers 2 s after the resume: 6 s of playing time, not an hour.
    state = run(state, { type: 'answer', playerId: 'p0', text: 'song 1' }, later + 2000);
    expect(state.rounds[0].answers.p0.elapsedMs).toBe(6000);
    // The remaining 9 s still run out on schedule.
    state = run(state, { type: 'tick' }, later + 11_000 + ANSWER_GRACE_MS);
    expect(state.phase).toBe('reveal');
  });

  it('ignores a pause when no clock is running', () => {
    const lobby = lobbyWith(['Ana']);
    expect(run(lobby, { type: 'pause', by: 'Ana' }, 5)).toBe(lobby);
  });

  it('takes one answer per player', () => {
    let state = guessing(['Ana', 'Ben']);
    state = run(state, { type: 'answer', playerId: 'p0', text: 'nope' }, 2000);
    expect(reduce(state, { type: 'answer', playerId: 'p0', text: 'song 1' }, 2500).ok).toBe(false);
  });

  it('times out on any tick after the deadline, stamped at the deadline', () => {
    let state = guessing(['Ana', 'Ben']);
    const early = run(state, { type: 'tick' }, 1000 + GUESS_MS - 1);
    expect(early).toBe(state);
    state = run(state, { type: 'tick' }, 1000 + GUESS_MS + ANSWER_GRACE_MS + 250);
    expect(state.phase).toBe('reveal');
    expect(state.rounds[0].revealStartedAt).toBe(1000 + GUESS_MS);
  });

  it('settles the deadline before a late answer, and says nothing went wrong', () => {
    const state = guessing(['Ana']);
    const result = reduce(state, { type: 'answer', playerId: 'p0', text: 'song 1' }, 1000 + GUESS_MS + 5000);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.phase).toBe('reveal');
      expect(result.state.players[0].score).toBe(0);
    }
  });

  it('moves on when the reveal ends or anyone asks, but only once', () => {
    let state = guessing(['Ana']);
    state = run(state, { type: 'answer', playerId: 'p0', text: 'x' }, 2000);
    const skipped = run(state, { type: 'next', roundIndex: 0 }, 3000);
    expect(skipped.phase).toBe('loading');
    expect(skipped.roundIndex).toBe(1);
    // A second "next" for the old round must not skip round two.
    expect(run(skipped, { type: 'next', roundIndex: 0 }, 3001)).toBe(skipped);

    const waited = run(state, { type: 'tick' }, 2000 + REVEAL_MS);
    expect(waited.roundIndex).toBe(1);
  });

  it('swaps in a spare when a preview will not play', () => {
    let state = lobbyWith(['Ana']);
    state = run(state, { type: 'start', songs: SONGS, spares: SPARES }, 0);
    state = run(state, { type: 'audio-failed', roundIndex: 0 }, 10);
    expect(state.rounds[0].song.id).toBe(101);
    expect(state.spares).toHaveLength(1);
    expect(state.phase).toBe('loading');
  });

  it('does not wait for a player who left', () => {
    let state = guessing(['Ana', 'Ben']);
    state = run(state, { type: 'answer', playerId: 'p0', text: 'song 1' }, 2000);
    state = run(state, { type: 'remove-player', playerId: 'p1' }, 2500);
    expect(state.phase).toBe('reveal');
  });

  it('plays ten rounds, finishes, and can start again with scores reset', () => {
    let state = lobbyWith(['Ana']);
    let now = 0;
    state = run(state, { type: 'start', songs: SONGS, spares: SPARES }, now);
    for (let i = 0; i < ROUNDS_PER_GAME; i++) {
      state = run(state, { type: 'audio-started', roundIndex: i }, (now += 100));
      state = run(state, { type: 'answer', playerId: 'p0', text: String(state.rounds[i].song[state.rounds[i].kind]) }, (now += 100));
      expect(state.phase).toBe('reveal');
      state = run(state, { type: 'next', roundIndex: i }, (now += 100));
    }
    expect(state.phase).toBe('finished');
    expect(state.players[0].score).toBeGreaterThan(9000);

    state = run(state, { type: 'start', songs: SONGS, spares: [] }, (now += 100));
    expect(state.phase).toBe('loading');
    expect(state.players[0].score).toBe(0);
    expect(state.playedSongIds).toHaveLength(ROUNDS_PER_GAME * 2);
  });
});

// A game's worth of rounds, with the early rounds already answered.
// `right` says, per round, who got it: knowledge of the artist.
function heardRounds(right: string[][]): Round[] {
  return right.map((ids, i) => ({
    kind: ROUND_KINDS[i],
    song: song(i + 1),
    guessStartedAt: 0,
    revealStartedAt: 1,
    answers: Object.fromEntries(
      ids.map((id) => [id, { text: 'x', elapsedMs: 0, correct: true, points: 800 }]),
    ),
  }));
}

/** A reprise of round `i`: another song by that round's artist. */
const reprise = (i: number) => song(200 + i, { artist: `Artist ${i}`, album: `Album ${200 + i}` });

const FIRST_ALBUM = ROUND_KINDS.indexOf('album');
const EVERYONE = ['p0', 'p1', 'p2'];

describe('reprises', () => {
  it('counts a right answer as knowing the artist, and a close year too', () => {
    const [round] = heardRounds([['p0']]);
    expect(knowers(round)).toEqual(['p0']);
    const year: Round = {
      ...round,
      kind: 'year',
      answers: {
        p0: { text: '1992', elapsedMs: 0, correct: false, yearsOff: 2, points: 700 },
        p1: { text: '1985', elapsedMs: 0, correct: false, yearsOff: 5, points: 100 },
        p2: { text: '', elapsedMs: 0, correct: false, gaveUp: true, points: 0 },
      },
    };
    expect(knowers(year)).toEqual(['p0']);
  });

  it('goes first to the artist the most people know', () => {
    const heard = heardRounds([['p0'], ['p0', 'p1', 'p2'], ['p1']]);
    const pool = [reprise(1), reprise(2), reprise(3)];
    expect(pickReprises(heard, pool, 1, EVERYONE)[0]?.id).toBe(202);
  });

  it('gives the second round to someone the first did not cover', () => {
    // Ana knows everything. Ben only knows round 3's artist.
    const heard = heardRounds([['p0'], ['p0'], ['p0', 'p1']]);
    const pool = [reprise(1), reprise(2), reprise(3)];
    const picks = pickReprises(heard, pool, 2, EVERYONE);
    expect(picks.map((s) => s?.id ?? null)).toEqual([203, 201]);

    // Two artists known by the same big crowd, one by a lone third player:
    // the second pick is the lone player's, not the crowd's second favourite.
    const crowd = heardRounds([['p0', 'p1'], ['p0', 'p1'], ['p2']]);
    expect(pickReprises(crowd, pool, 2, EVERYONE).map((s) => s?.id ?? null)).toEqual([201, 203]);
  });

  it('never repeats an artist, and stays with known artists when nobody new can be covered', () => {
    const heard = heardRounds([['p0'], ['p0'], []]);
    const pool = [reprise(1), reprise(2), reprise(3), song(250, { artist: 'Artist 1' })];
    const picks = pickReprises(heard, pool, 3, EVERYONE);
    expect(picks.map((s) => s?.id ?? null)).toEqual([201, 202, null]);
  });

  it('ignores artists nobody got right, and players who have left', () => {
    const heard = heardRounds([['p0'], ['gone'], []]);
    const pool = [reprise(1), reprise(2), reprise(3)];
    expect(pickReprises(heard, pool, 2, EVERYONE).map((s) => s?.id ?? null)).toEqual([201, null]);
    expect(pickReprises(heard, [], 2, EVERYONE)).toEqual([null, null]);
  });

  it('swaps the album rounds on the way into the round before them', () => {
    let state = lobbyWith(['Ana', 'Ben']);
    const pool = [reprise(1), reprise(4)];
    state = run(state, { type: 'start', songs: SONGS, spares: SPARES, reprises: pool }, 0);
    let now = 0;
    for (let i = 0; i < FIRST_ALBUM - 1; i++) {
      state = run(state, { type: 'audio-started', roundIndex: i }, (now += 100));
      // Ana gets rounds 1 and 4; Ben gets round 4 only.
      const right = String(state.rounds[i].song[state.rounds[i].kind]);
      state = run(state, { type: 'answer', playerId: 'p0', text: i === 0 || i === 3 ? right : 'no' }, (now += 100));
      state = run(state, { type: 'answer', playerId: 'p1', text: i === 3 ? right : 'no' }, (now += 100));
      const before = state.rounds.map((r) => r.song.id);
      state = run(state, { type: 'next', roundIndex: i }, (now += 100));
      if (i < FIRST_ALBUM - 2) expect(state.rounds.map((r) => r.song.id)).toEqual(before);
    }
    expect(state.roundIndex).toBe(FIRST_ALBUM - 1);
    // Round 4's artist is known by both, so it leads; round 1's covers nobody new but still beats a cold draw.
    expect(state.rounds.slice(FIRST_ALBUM).map((r) => r.song.id)).toEqual([204, 201]);
    expect(state.rounds.slice(FIRST_ALBUM).every((r) => r.kind === 'album')).toBe(true);
    expect(state.reprises).toEqual([]);
    // The album songs drawn at start were never heard: they become spares, not history.
    expect(state.spares.map((s) => s.id)).toEqual([101, 102, FIRST_ALBUM + 1, FIRST_ALBUM + 2]);
    expect(state.playedSongIds).not.toContain(FIRST_ALBUM + 1);
    expect(state.playedSongIds).toEqual(expect.arrayContaining([204, 201]));
    // The host prefetches the reprise, not the displaced song.
    const host = viewFor(state, { role: 'host' }, now);
    expect(host.round?.nextPreviewUrl).toBe('https://audio/204.m4a');
  });

  it('keeps the draw when nobody got anything right, or a room predates reprises', () => {
    let state = lobbyWith(['Ana']);
    state = run(state, { type: 'start', songs: SONGS, spares: SPARES, reprises: [reprise(1)] }, 0);
    let now = 0;
    for (let i = 0; i < FIRST_ALBUM - 1; i++) {
      state = run(state, { type: 'audio-started', roundIndex: i }, (now += 100));
      state = run(state, { type: 'answer', playerId: 'p0', text: 'no' }, (now += 100));
      state = run(state, { type: 'next', roundIndex: i }, (now += 100));
    }
    expect(state.rounds.map((r) => r.song.id)).toEqual(SONGS.map((s) => s.id));
    expect(state.spares).toEqual(SPARES);

    const old = { ...guessing(['Ana']), reprises: undefined } as unknown as RoomState;
    expect(reduce(old, { type: 'next', roundIndex: 0 }, 2000).ok).toBe(true);
  });
});

describe('views', () => {
  it('keeps the answer away from every screen until the reveal', () => {
    let state = guessing(['Ana', 'Ben']);
    state = run(state, { type: 'answer', playerId: 'p0', text: 'song 1' }, 2000);

    const player = viewFor(state, { role: 'player', playerId: 'p0' }, 2000);
    const host = viewFor(state, { role: 'host' }, 2000);
    expect(JSON.stringify(player)).not.toContain('Song 1');
    expect(JSON.stringify(player)).not.toContain('audio/');
    expect(JSON.stringify(player)).not.toContain('t0');
    expect(JSON.stringify(host)).not.toContain('Song 1');
    expect(host.round?.previewUrl).toBe('https://audio/1.m4a');
    expect(player.you?.answer).toEqual({ text: 'song 1', elapsedMs: 1000, gaveUp: false });
    expect(player.players.map((p) => p.answered)).toEqual([true, false]);

    state = run(state, { type: 'answer', playerId: 'p1', text: 'x' }, 3000);
    const revealed = viewFor(state, { role: 'player', playerId: 'p1' }, 3000);
    expect(revealed.round?.song?.title).toBe('Song 1');
    expect(revealed.round?.answers).toHaveLength(2);
    expect(JSON.stringify(revealed)).not.toContain('host-token');
  });
});

describe('catalog', () => {
  it('never repeats an artist or a heard song while it has a choice', () => {
    const songs = [
      ...Array.from({ length: 20 }, (_, i) => song(i + 1)),
      song(50, { artist: 'Artist 1' }),
    ];
    const picked = chooseSongs(10, [1, 2, 3], Math.random, songs);
    expect(picked).toHaveLength(10);
    expect(new Set(picked.map((s) => s.artist)).size).toBe(10);
    expect(picked.some((s) => [1, 2, 3].includes(s.id))).toBe(false);
  });

  it('treats a duet as the lead artist for variety', () => {
    const songs = [song(1, { artist: 'Queen' }), song(2, { artist: 'Queen & David Bowie' }), song(3)];
    const picked = chooseSongs(2, [], Math.random, songs);
    expect(picked.map((s) => s.artist).filter((a) => a.startsWith('Queen'))).toHaveLength(1);
  });

  it('ends on party songs the game did not ask about, opening on a different one each game', () => {
    const all = chooseFinales([]);
    expect(all.length).toBeGreaterThan(3);
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    for (let i = 0; i < 20; i++) {
      const next = chooseFinales([all[1]], all[0].id);
      expect(next[0].id).not.toBe(all[0].id);
      expect(next.some((s) => s.id === all[1].id)).toBe(false);
    }
  });

  it('repeats the songs heard longest ago first, once everything has been heard', () => {
    const songs = Array.from({ length: 6 }, (_, i) => song(i + 1));
    const picked = chooseSongs(2, [4, 2, 6, 1, 5, 3], Math.random, songs);
    expect(picked.map((s) => s.id)).toEqual([4, 2]);
  });

  it('falls back to repeats rather than coming up short', () => {
    const songs = Array.from({ length: 6 }, (_, i) => song(i + 1, { artist: 'Same' }));
    expect(chooseSongs(5, [1, 2], Math.random, songs)).toHaveLength(5);
  });

  it('draws one unheard reprise per artist heard, and none for an artist with nothing left', () => {
    const songs = [
      song(1, { artist: 'Queen' }),
      song(2, { artist: 'Queen & David Bowie' }),
      song(3, { artist: 'Queen' }),
      song(4, { artist: 'ABBA' }),
      song(5, { artist: 'ABBA' }),
      song(6, { artist: 'Prince' }),
    ];
    const heard = [songs[0], songs[3], songs[5]];
    for (let i = 0; i < 20; i++) {
      const picked = chooseReprises(heard, [1, 4, 6, 5], Math.random, songs);
      expect(picked).toHaveLength(1);
      expect([2, 3]).toContain(picked[0].id);
    }
  });
});
