import { describe, expect, it } from 'vitest';

import { ROUND_KINDS, ROUNDS_PER_GAME, SPARE_SONGS } from '@/lib/game/config';

import { drawGame } from './preview';

describe('shuffle preview', () => {
  it('lays a draw out the way a room would play it', async () => {
    const draw = await drawGame();
    expect(draw.rounds.map((r) => r.kind)).toEqual(ROUND_KINDS);
    expect(draw.rounds).toHaveLength(ROUNDS_PER_GAME);
    expect(draw.spares).toHaveLength(SPARE_SONGS);
    expect(draw.finales.length).toBeGreaterThan(0);

    const ids = [...draw.rounds.map((r) => r.song.id), ...draw.spares.map((s) => s.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(draw.finales.some((f) => ids.includes(f.id))).toBe(false);
  });

  it('draws a different game each time', async () => {
    const a = await drawGame();
    const b = await drawGame();
    expect(a.rounds.map((r) => r.song.id)).not.toEqual(b.rounds.map((r) => r.song.id));
  });
});
