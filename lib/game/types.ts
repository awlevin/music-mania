// The frozen contract between the server reducer and both screens.
//
// RoomState is the full, secret-bearing state that lives in the store. Screens
// never see it: they get a RoomView, built per recipient by `views.ts`, which
// holds back the answer until the reveal.

export type QuestionKind = 'title' | 'artist' | 'year' | 'album';

export type Phase = 'lobby' | 'loading' | 'guessing' | 'reveal' | 'finished';

/**
 * How the room is played. `tv`: a big screen plays the music and phones
 * answer. `aux`: no big screen; one phone (the DJ) plays the music and
 * answers too. `solo`: aux with a single seat and no lobby.
 */
export type Mode = 'tv' | 'aux' | 'solo';

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
  /** The player tapped out instead of answering. */
  gaveUp?: boolean;
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
  mode: Mode;
  /** Aux and solo: the player whose device plays the music. Null on a tv room. */
  dj: string | null;
  phase: Phase;
  players: Player[];
  rounds: Round[];
  roundIndex: number;
  /** Swapped in when a preview refuses to play. */
  spares: Song[];
  /** What the host plays over the final scores, in order, each fading into the next. */
  finales: Song[];
  /** Set while someone has the game paused. Every deadline waits for it. */
  pause: { at: number; by: string } | null;
  /** What the host plays while people join. */
  lobbyUrl: string | null;
  /** Every song this room has heard, so "play again" never repeats one. */
  playedSongIds: number[];
  createdAt: number;
}

export type Action =
  | { type: 'join'; playerId: string; token: string; name: string }
  | { type: 'rename'; playerId: string; name: string }
  | { type: 'remove-player'; playerId: string }
  | { type: 'start'; songs: Song[]; spares: Song[]; finales?: Song[] }
  | { type: 'pause'; by: string }
  | { type: 'resume' }
  | { type: 'audio-started'; roundIndex: number }
  | { type: 'audio-failed'; roundIndex: number }
  | { type: 'answer'; playerId: string; text: string }
  | { type: 'give-up'; playerId: string }
  | { type: 'next'; roundIndex: number }
  | { type: 'pass-aux'; playerId: string }
  | { type: 'tick' };

export type ReduceResult = { ok: true; state: RoomState } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Views

export interface PlayerView {
  id: string;
  name: string;
  score: number;
  /** True once this player has locked in an answer for the current round, or given up. */
  answered: boolean;
  /** Giving up is public the moment it happens: the TV makes a scene of it. */
  gaveUp: boolean;
  /** This player's phone is the one playing the music. */
  dj: boolean;
}

export interface RevealedAnswer extends Answer {
  playerId: string;
}

export interface RoundView {
  index: number;
  total: number;
  kind: QuestionKind;
  /** True on the first round of each kind: the screens announce the new question. */
  kindChanged: boolean;
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
  mode: Mode;
  phase: Phase;
  players: PlayerView[];
  round: RoundView | null;
  /** Host only, from the last reveal on: the songs for the final scores. */
  finaleUrls?: string[];
  /** While paused: when it began on the server clock (timers freeze there), and who did it. */
  pause: { at: number; by: string } | null;
  /** Host only, in the lobby: music to join by. */
  lobbyUrl?: string;
  /** Players only. */
  you?: {
    id: string;
    /** The first player in the room runs it from their phone: start, play again. */
    leader: boolean;
    /** This phone plays the music: it gets the preview URLs and reports when audio starts. */
    dj: boolean;
    /** What this player locked in. Whether it was right waits for the reveal. */
    answer: { text: string; elapsedMs: number; gaveUp: boolean } | null;
  };
  /** Server clock when this view was built; screens derive their offset from it. */
  serverNow: number;
}
