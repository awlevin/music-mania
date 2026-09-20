// One game's worth of songs, laid out the way a room would play them, for
// the shuffle preview page. It draws through `drawSongs` so what it shows is
// what pressing Start would have produced.

import { ROUND_KINDS, ROUNDS_PER_GAME, SPARE_SONGS } from '@/lib/game/config';
import type { QuestionKind, Song } from '@/lib/game/types';

import { drawSongs } from './index';

export interface DrawnRound {
  kind: QuestionKind;
  song: Song;
}

export interface GameDraw {
  /** In playing order, each with the question it would have asked. */
  rounds: DrawnRound[];
  /** In the order they would be swapped in, should a preview refuse to play. */
  spares: Song[];
  /** In the order they would play over the final scores. */
  finales: Song[];
  /** What the album rounds may become, depending on who gets what right. */
  reprises: Song[];
  drawnAt: number;
}

export function layOut(songs: Song[], finales: Song[], reprises: Song[], drawnAt: number): GameDraw {
  return {
    rounds: ROUND_KINDS.map((kind, i) => ({ kind, song: songs[i] })),
    spares: songs.slice(ROUNDS_PER_GAME),
    finales,
    reprises,
    drawnAt,
  };
}

/** A fresh room's first game: nothing heard yet, no finale to avoid. */
export async function drawGame(): Promise<GameDraw> {
  const { songs, finales, reprises } = await drawSongs(ROUNDS_PER_GAME + SPARE_SONGS, []);
  return layOut(songs, finales, reprises, Date.now());
}
