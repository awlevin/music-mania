import { ANSWER_GRACE_MS, GUESS_MS, REVEAL_MS } from './config';
import type { Phase, RoundView } from './types';

/**
 * When the current phase must end, on the server's clock, or null when no
 * clock is running. Every screen uses this to know when to send `tick`.
 */
export function phaseDeadline(view: { phase: Phase; round: RoundView | null }): number | null {
  const round = view.round;
  if (!round) return null;
  if (view.phase === 'guessing' && round.guessStartedAt !== null) {
    return round.guessStartedAt + GUESS_MS + ANSWER_GRACE_MS;
  }
  if (view.phase === 'reveal' && round.revealStartedAt !== null) {
    return round.revealStartedAt + REVEAL_MS;
  }
  return null;
}
