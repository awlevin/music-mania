import type { PlayerView } from './types';

export interface Ranked {
  player: PlayerView;
  /** Tied scores share a rank: 1, 2, 2, 4. */
  rank: number;
}

export function rankPlayers(players: readonly PlayerView[]): Ranked[] {
  const sorted = players
    .map((player, joined) => ({ player, joined }))
    .sort((a, b) => b.player.score - a.player.score || a.joined - b.joined);
  let rank = 0;
  return sorted.map(({ player }, i) => {
    if (i === 0 || player.score < sorted[i - 1].player.score) rank = i + 1;
    return { player, rank };
  });
}
