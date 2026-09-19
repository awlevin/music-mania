// Difficulty is how far back the songs reach. Easy draws from two decades,
// medium from four, hard from six; the most recent ones unless the host picks
// others. The catalog covers the 1960s to the 2020s.

import type { Difficulty, Setup } from './types';

/** Start year of every decade the catalog covers, oldest first. */
export const DECADES: readonly number[] = [1960, 1970, 1980, 1990, 2000, 2010, 2020];

export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];

/** How many decades a game draws from at each difficulty. */
export const DECADE_COUNT: Record<Difficulty, number> = { easy: 2, medium: 4, hard: 6 };

export const DIFFICULTY_NAME: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

export const DEFAULT_DIFFICULTY: Difficulty = 'easy';

export function isDifficulty(value: unknown): value is Difficulty {
  return DIFFICULTIES.includes(value as Difficulty);
}

/** 1987 → 1980. */
export function decadeOf(year: number): number {
  return Math.floor(year / 10) * 10;
}

/** 1980 → "1980s". */
export function decadeName(decade: number): string {
  return `${decade}s`;
}

/** The most recent decades, as many as the difficulty asks for, oldest first. */
export function defaultDecades(difficulty: Difficulty): number[] {
  return DECADES.slice(-DECADE_COUNT[difficulty]);
}

export function defaultSetup(difficulty: Difficulty = DEFAULT_DIFFICULTY): Setup {
  return { difficulty, decades: defaultDecades(difficulty) };
}

/** Known decades, none twice, exactly as many as the difficulty asks for. */
export function isValidSetup(setup: Setup): boolean {
  return (
    isDifficulty(setup.difficulty) &&
    setup.decades.length === DECADE_COUNT[setup.difficulty] &&
    new Set(setup.decades).size === setup.decades.length &&
    setup.decades.every((d) => DECADES.includes(d))
  );
}

/**
 * Pick a decade. One already picked changes nothing; a new one takes the
 * place of the pick made longest ago, so any set of decades is a few taps
 * away and the count never changes.
 */
export function pickDecade(setup: Setup, decade: number): Setup {
  if (!DECADES.includes(decade) || setup.decades.includes(decade)) return setup;
  const decades = [...setup.decades.slice(-(DECADE_COUNT[setup.difficulty] - 1)), decade];
  return { ...setup, decades };
}

/**
 * Change the difficulty, keeping as many of the current picks as fit (the
 * most recent ones) and filling any new room with the most recent decades
 * not yet picked.
 */
export function withDifficulty(setup: Setup, difficulty: Difficulty): Setup {
  if (difficulty === setup.difficulty) return setup;
  const count = DECADE_COUNT[difficulty];
  const kept = setup.decades
    .filter((d) => DECADES.includes(d))
    .sort((a, b) => a - b)
    .slice(-count);
  const room = count - kept.length;
  const fill = room > 0 ? DECADES.filter((d) => !kept.includes(d)).slice(-room) : [];
  return { difficulty, decades: [...kept, ...fill].sort((a, b) => a - b) };
}

/** "the 2010s and 2020s"; "the 1990s, 2000s, 2010s and 2020s". */
export function describeDecades(decades: readonly number[]): string {
  const names = decades
    .slice()
    .sort((a, b) => a - b)
    .map(decadeName);
  if (names.length === 0) return 'every decade';
  if (names.length === 1) return `the ${names[0]}`;
  return `the ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
