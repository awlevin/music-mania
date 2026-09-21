// A game draws from the decades the host has switched on. Easy, medium and
// hard are presets: the two, four or six most recent decades. They are a
// starting point, not a limit, so any mix of decades is a valid game. The
// catalog covers the 1960s to the 2020s.

import type { Difficulty, Setup } from './types';

/** Start year of every decade the catalog covers, oldest first. */
export const DECADES: readonly number[] = [1960, 1970, 1980, 1990, 2000, 2010, 2020];

export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];

/** How many decades back each preset reaches. */
export const DECADE_COUNT: Record<Difficulty, number> = { easy: 2, medium: 4, hard: 6 };

export const DIFFICULTY_NAME: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

/** What a mix of decades is called when it matches no preset. */
export const CUSTOM_NAME = 'Your mix';

export const DEFAULT_DIFFICULTY: Difficulty = 'easy';

/** 1987 → 1980. */
export function decadeOf(year: number): number {
  return Math.floor(year / 10) * 10;
}

/** 1980 → "1980s". */
export function decadeName(decade: number): string {
  return `${decade}s`;
}

/** The decades a preset switches on: the most recent ones, oldest first. */
export function presetDecades(difficulty: Difficulty): number[] {
  return DECADES.slice(-DECADE_COUNT[difficulty]);
}

export function defaultSetup(difficulty: Difficulty = DEFAULT_DIFFICULTY): Setup {
  return { decades: presetDecades(difficulty) };
}

/** The preset these decades match exactly, in any order; null for a mix of the host's own. */
export function presetOf(decades: readonly number[]): Difficulty | null {
  const key = sorted(decades).join();
  return DIFFICULTIES.find((d) => presetDecades(d).join() === key) ?? null;
}

/** "Easy", "Medium", "Hard", or "Your mix". */
export function setupName(decades: readonly number[]): string {
  const preset = presetOf(decades);
  return preset ? DIFFICULTY_NAME[preset] : CUSTOM_NAME;
}

/** At least one decade, all of them known, none twice. */
export function isValidSetup(setup: Setup): boolean {
  return (
    Array.isArray(setup.decades) &&
    setup.decades.length > 0 &&
    new Set(setup.decades).size === setup.decades.length &&
    setup.decades.every((d) => DECADES.includes(d))
  );
}

/**
 * Switch a decade on or off. The last one stays on: a game needs songs to
 * draw from. Decades come back oldest first.
 */
export function toggleDecade(setup: Setup, decade: number): Setup {
  if (!DECADES.includes(decade)) return setup;
  if (!setup.decades.includes(decade)) return { ...setup, decades: sorted([...setup.decades, decade]) };
  if (setup.decades.length === 1) return setup;
  return { ...setup, decades: setup.decades.filter((d) => d !== decade) };
}

/**
 * The decades in a few characters. A run of them reads as a span: "2010–now"
 * when it reaches the present, "1960s–1980s" when it does not. Two runs read
 * as two spans, a scattered few are listed, and past that it is "5 decades".
 */
export function describeDecades(decades: readonly number[]): string {
  const picked = sorted(decades);
  if (picked.length === 0) return 'Every decade';
  const runs: number[][] = [];
  for (const decade of picked) {
    const run = runs[runs.length - 1];
    if (run && decade - run[run.length - 1] === 10) run.push(decade);
    else runs.push([decade]);
  }
  if (runs.length <= 2) return runs.map(describeRun).join(', ');
  return picked.length <= 3 ? picked.map(decadeName).join(', ') : `${picked.length} decades`;
}

function describeRun(run: readonly number[]): string {
  const first = run[0];
  const last = run[run.length - 1];
  if (first === last) return decadeName(first);
  return last === DECADES[DECADES.length - 1] ? `${first}–now` : `${decadeName(first)}–${decadeName(last)}`;
}

function sorted(decades: readonly number[]): number[] {
  return decades.slice().sort((a, b) => a - b);
}
