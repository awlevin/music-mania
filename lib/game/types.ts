// The frozen contract between the server reducer and both screens.
//
// RoomState is the full, secret-bearing state that lives in the store. Screens
// never see it: they get a RoomView, built per recipient by `views.ts`, which
// holds back the answer until the reveal.

export type QuestionKind = 'title' | 'artist' | 'year' | 'album';

export type Phase = 'lobby' | 'loading' | 'guessing' | 'reveal' | 'finished';

export interface Song {
  /** iTunes trackId. */
  id: number;
  title: string;
  artist: string;
  album: string;
  year: number;
  genre: string;
  artworkUrl: string;
  previewUrl: string;
}

export interface Player {
  id: string;
  /** Secret the phone keeps in localStorage; proves it owns this seat. */
  token: string;
  name: string;
  score: number;
}

export interface Answer {
  text: string;
  /** Milliseconds between the audio starting and the server receiving this. */
  elapsedMs: number;
  correct: boolean;
  /** Year rounds only: how many years off the guess was. */
  yearsOff?: number;
  points: number;
}

export interface Round {
  kind: QuestionKind;
  song: Song;
  /** Server clock when the host reported the audio playing. */
  guessStartedAt: number | null;
  revealStartedAt: number | null;
  answers: Record<string, Answer>;
}

export interface RoomState {
  code: string;
  version: number;
  hostToken: string;
  phase: Phase;
  players: Player[];
  rounds: Round[];
  roundIndex: number;
  /** Swapped in when a preview refuses to play. */
  spares: Song[];
  /** Every song this room has heard, so "play again" never repeats one. */
  playedSongIds: number[];
  createdAt: number;
}

export type Action =
  | { type: 'join'; playerId: string; token: string; name: string }
  | { type: 'rename'; playerId: string; name: string }
  | { type: 'remove-player'; playerId: string }
  | { type: 'start'; songs: Song[]; spares: Song[] }
  | { type: 'audio-started'; roundIndex: number }
  | { type: 'audio-failed'; roundIndex: number }
  | { type: 'answer'; playerId: string; text: string }
  | { type: 'next'; roundIndex: number }
  | { type: 'tick' };

export type ReduceResult = { ok: true; state: RoomState } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Views

export interface PlayerView {
  id: string;
  name: string;
  score: number;
  /** True once this player has locked in an answer for the current round. */
  answered: boolean;
}

export interface RevealedAnswer extends Answer {
  playerId: string;
}

export interface RoundView {
  index: number;
  total: number;
  kind: QuestionKind;
  guessStartedAt: number | null;
  revealStartedAt: number | null;
  /** Host only: what to play. A preview URL does not name the song. */
  previewUrl?: string;
  /** Host only: the next round's preview, so it can be fetched ahead. */
  nextPreviewUrl?: string;
  /** Present from the reveal onwards. */
  song?: Song;
  answers?: RevealedAnswer[];
}

export interface RoomView {
  code: string;
  version: number;
  phase: Phase;
  players: PlayerView[];
  round: RoundView | null;
  /** Players only. */
  you?: {
    id: string;
    /** What this player locked in. Whether it was right waits for the reveal. */
    answer: { text: string; elapsedMs: number } | null;
  };
  /** Server clock when this view was built; screens derive their offset from it. */
  serverNow: number;
}
