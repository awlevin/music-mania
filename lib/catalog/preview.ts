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
  drawnAt: number;
}

export function layOut(songs: Song[], finales: Song[], drawnAt: number): GameDraw {
  return {
    rounds: ROUND_KINDS.map((kind, i) => ({ kind, song: songs[i] })),
    spares: songs.slice(ROUNDS_PER_GAME),
    finales,
    drawnAt,
  };
}

/** A fresh room's first game: nothing heard yet, no finale to avoid. */
export async function drawGame(): Promise<GameDraw> {
  const { songs, finales } = await drawSongs(ROUNDS_PER_GAME + SPARE_SONGS, []);
  return layOut(songs, finales, Date.now());
}
