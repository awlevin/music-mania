import { GUESS_MS, MAX_POINTS, MIN_POINTS } from './config';
import { matchesArtist, matchesText, parseYear } from './match';
import type { Answer, QuestionKind, Song } from './types';

/** A right answer is worth MAX_POINTS at 0 s, falling evenly to MIN_POINTS at the buzzer. */
export function speedPoints(elapsedMs: number): number {
  const t = Math.min(Math.max(elapsedMs / GUESS_MS, 0), 1);
  return Math.round(MAX_POINTS - (MAX_POINTS - MIN_POINTS) * t);
}

/** Year rounds pay part of the pot for a near miss. */
const YEAR_SHARE: Record<number, number> = { 0: 1, 1: 0.5, 2: 0.25 };

export function grade(kind: QuestionKind, song: Song, text: string, elapsedMs: number): Answer {
  const base: Answer = { text, elapsedMs, correct: false, points: 0 };

  if (kind === 'year') {
    const year = parseYear(text);
    if (year === null) return base;
    const yearsOff = Math.abs(year - song.year);
    const share = YEAR_SHARE[yearsOff] ?? 0;
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
