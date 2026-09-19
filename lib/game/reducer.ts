// The whole game as one pure function: (state, action, now) → state.
//
// Nothing here owns a timer. Phases end on deadlines derived from timestamps
// in the state, and every call settles overdue deadlines before it looks at
// the action. Any screen may send `tick` when its own clock says a deadline
// passed; the first one moves the room on, the rest are no-ops. That is what
// lets the server be a set of stateless functions.

import {
  ANSWER_GRACE_MS,
  GUESS_MS,
  MAX_ANSWER_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  REVEAL_MS,
  ROUND_KINDS,
} from './config';
import { grade } from './score';
import type { Action, ReduceResult, RoomState, Round, Song } from './types';

export function createRoom(code: string, hostToken: string, now: number): RoomState {
  return {
    code,
    version: 1,
    hostToken,
    phase: 'lobby',
    players: [],
    rounds: [],
    roundIndex: 0,
    spares: [],
    finale: null,
    playedSongIds: [],
    createdAt: now,
  };
}

export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

const fail = (error: string): ReduceResult => ({ ok: false, error });

function currentRound(state: RoomState): Round | undefined {
  return state.rounds[state.roundIndex];
}

function withRound(state: RoomState, round: Round): RoomState {
  const rounds = state.rounds.slice();
  rounds[state.roundIndex] = round;
  return { ...state, rounds };
}

function startReveal(state: RoomState, now: number): RoomState {
  const round = currentRound(state)!;
  const players = state.players.map((p) => ({
    ...p,
    score: p.score + (round.answers[p.id]?.points ?? 0),
  }));
  return { ...withRound(state, { ...round, revealStartedAt: now }), players, phase: 'reveal' };
}

function advance(state: RoomState): RoomState {
  const last = state.roundIndex >= state.rounds.length - 1;
  return last
    ? { ...state, phase: 'finished' }
    : { ...state, phase: 'loading', roundIndex: state.roundIndex + 1 };
}

/** Move past any deadline that `now` has already crossed. */
export function settle(state: RoomState, now: number): RoomState {
  const round = currentRound(state);
  if (!round) return state;
  if (
    state.phase === 'guessing' &&
    round.guessStartedAt !== null &&
    now >= round.guessStartedAt + GUESS_MS + ANSWER_GRACE_MS
  ) {
    // Stamp the reveal at the deadline itself, so a late tick cannot stretch it.
    return settle(startReveal(state, round.guessStartedAt + GUESS_MS), now);
  }
  if (
    state.phase === 'reveal' &&
    round.revealStartedAt !== null &&
    now >= round.revealStartedAt + REVEAL_MS
  ) {
    return advance(state);
  }
  return state;
}

function newRounds(songs: Song[]): Round[] {
  return ROUND_KINDS.map((kind, i) => ({
    kind,
    song: songs[i],
    guessStartedAt: null,
    revealStartedAt: null,
    answers: {},
  }));
}

export function reduce(prev: RoomState, action: Action, now: number): ReduceResult {
  const state = settle(prev, now);
  const next = apply(state, action, now);
  if (!next.ok) {
    // The action was refused, but a deadline may still have passed.
    return state === prev ? next : { ok: true, state: bump(prev, state) };
  }
  return { ok: true, state: bump(prev, next.state) };
}

function bump(prev: RoomState, next: RoomState): RoomState {
  return next === prev ? prev : { ...next, version: prev.version + 1 };
}

function apply(state: RoomState, action: Action, now: number): ReduceResult {
  switch (action.type) {
    case 'join': {
      const name = cleanName(action.name);
      if (!name) return fail('Enter a name to join.');
      if (state.players.length >= MAX_PLAYERS) return fail('This room is full.');
      if (state.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
        return fail(`Someone here is already called ${name}. Pick another name.`);
      }
      const player = { id: action.playerId, token: action.token, name, score: 0 };
      return { ok: true, state: { ...state, players: [...state.players, player] } };
    }

    case 'rename': {
      const name = cleanName(action.name);
      if (!name) return fail('Enter a name.');
      if (
        state.players.some(
          (p) => p.id !== action.playerId && p.name.toLowerCase() === name.toLowerCase(),
        )
      ) {
        return fail(`Someone here is already called ${name}.`);
      }
      const players = state.players.map((p) => (p.id === action.playerId ? { ...p, name } : p));
      return { ok: true, state: { ...state, players } };
    }

    case 'remove-player': {
      if (!state.players.some((p) => p.id === action.playerId)) return { ok: true, state };
      const players = state.players.filter((p) => p.id !== action.playerId);
      const next = { ...state, players };
      // Nobody should wait on a player who has gone.
      return { ok: true, state: allAnswered(next) ? startReveal(next, now) : next };
    }

    case 'start': {
      if (state.phase !== 'lobby' && state.phase !== 'finished') {
        return fail('The game is already running.');
      }
      if (state.players.length === 0) return fail('Wait for a player to join first.');
      if (action.songs.length < ROUND_KINDS.length) return fail('Not enough songs to start.');
      return {
        ok: true,
        state: {
          ...state,
          phase: 'loading',
          roundIndex: 0,
          rounds: newRounds(action.songs),
          spares: action.spares,
          finale: action.finale ?? null,
          players: state.players.map((p) => ({ ...p, score: 0 })),
          playedSongIds: [...state.playedSongIds, ...action.songs.map((s) => s.id)],
        },
      };
    }

    case 'audio-started': {
      if (state.phase !== 'loading' || action.roundIndex !== state.roundIndex) {
        return { ok: true, state };
      }
      const round = currentRound(state)!;
      return {
        ok: true,
        state: { ...withRound(state, { ...round, guessStartedAt: now }), phase: 'guessing' },
      };
    }

    case 'audio-failed': {
      if (state.phase !== 'loading' || action.roundIndex !== state.roundIndex) {
        return { ok: true, state };
      }
      const [spare, ...spares] = state.spares;
      if (!spare) return { ok: true, state: advance(state) };
      const round = currentRound(state)!;
      return {
        ok: true,
        state: {
          ...withRound(state, { ...round, song: spare }),
          spares,
          playedSongIds: [...state.playedSongIds, spare.id],
        },
      };
    }

    case 'answer': {
      const round = currentRound(state);
      if (state.phase !== 'guessing' || !round || round.guessStartedAt === null) {
        return fail('Time is up for this song.');
      }
      if (!state.players.some((p) => p.id === action.playerId)) return fail('You are not in this room.');
      if (round.answers[action.playerId]) return fail('You already locked in an answer.');
      const text = action.text.trim().slice(0, MAX_ANSWER_LENGTH);
      if (!text) return fail('Type an answer first.');

      const elapsedMs = Math.min(Math.max(now - round.guessStartedAt, 0), GUESS_MS);
      const answer = grade(round.kind, round.song, text, elapsedMs);
      const next = withRound(state, {
        ...round,
        answers: { ...round.answers, [action.playerId]: answer },
      });
      return { ok: true, state: allAnswered(next) ? startReveal(next, now) : next };
    }

    case 'give-up': {
      const round = currentRound(state);
      if (state.phase !== 'guessing' || !round || round.guessStartedAt === null) {
        return { ok: true, state };
      }
      if (!state.players.some((p) => p.id === action.playerId)) return fail('You are not in this room.');
      if (round.answers[action.playerId]) return fail('You already locked in an answer.');
      const elapsedMs = Math.min(Math.max(now - round.guessStartedAt, 0), GUESS_MS);
      const next = withRound(state, {
        ...round,
        answers: {
          ...round.answers,
          [action.playerId]: { text: '', elapsedMs, correct: false, gaveUp: true, points: 0 },
        },
      });
      return { ok: true, state: allAnswered(next) ? startReveal(next, now) : next };
    }

    case 'next': {
      if (state.phase !== 'reveal' || action.roundIndex !== state.roundIndex) {
        return { ok: true, state };
      }
      return { ok: true, state: advance(state) };
    }

    case 'tick':
      return { ok: true, state };
  }
}

function allAnswered(state: RoomState): boolean {
  if (state.phase !== 'guessing') return false;
  const round = currentRound(state);
  if (!round || state.players.length === 0) return false;
  return state.players.every((p) => round.answers[p.id]);
}
