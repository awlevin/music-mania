import { GUESS_MS, MAX_POINTS, MIN_POINTS } from './config';
import { matchesArtist, matchesText, parseYear } from './match';
import type { Answer, QuestionKind, Song } from './types';

/** A right answer is worth MAX_POINTS at 0 s, falling evenly to MIN_POINTS at the buzzer. */
export function speedPoints(elapsedMs: number): number {
  const t = Math.min(Math.max(elapsedMs / GUESS_MS, 0), 1);
  return Math.round(MAX_POINTS - (MAX_POINTS - MIN_POINTS) * t);
}

/**
 * Year rounds pay by closeness, on a bell curve: a near miss keeps most of
 * the pot, and past a few years it falls away fast.
 *   off by 0 → 100%, 1 → 92%, 2 → 73%, 3 → 49%, 4 → 28%, 5 → 14%, 6 → 6%, 7+ → 0
 */
const YEAR_SPREAD = 2.5;
const YEAR_FLOOR = 0.05;

export function yearShare(yearsOff: number): number {
  const share = Math.exp(-(yearsOff * yearsOff) / (2 * YEAR_SPREAD * YEAR_SPREAD));
  return share < YEAR_FLOOR ? 0 : share;
}

export function grade(kind: QuestionKind, song: Song, text: string, elapsedMs: number): Answer {
  const base: Answer = { text, elapsedMs, correct: false, points: 0 };

  if (kind === 'year') {
    const year = parseYear(text);
    if (year === null) return base;
    const yearsOff = Math.abs(year - song.year);
    const share = yearShare(yearsOff);
    return {
      ...base,
      yearsOff,
      correct: yearsOff === 0,
      points: Math.round(speedPoints(elapsedMs) * share),
    };
  }

  const correct =
    kind === 'artist' ? matchesArtist(text, song.artist) : matchesText(text, song[kind]);
  return { ...base, correct, points: correct ? speedPoints(elapsedMs) : 0 };
}
