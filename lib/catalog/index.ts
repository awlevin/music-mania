// Where songs come from. Today the catalog is a JSON file in the repo; the
// plan (docs/ROADMAP.md) is to move it to a database that grows as people
// play. Everything outside this folder goes through `pickSongs`, so that move
// touches nothing else.

import catalog from '@/data/catalog.json';
import type { Song } from '@/lib/game/types';

import { refreshPreviews } from './itunes';

const SONGS = catalog as Song[];

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * `count` songs this room has not heard, no artist twice. Falls back to
 * repeats only when the catalog cannot do better.
 */
export function chooseSongs(
  count: number,
  excludeIds: readonly number[],
  random: () => number = Math.random,
  songs: readonly Song[] = SONGS,
): Song[] {
  const exclude = new Set(excludeIds);
  const fresh = shuffle(
    songs.filter((s) => !exclude.has(s.id)),
    random,
  );
  const heard = shuffle(
    songs.filter((s) => exclude.has(s.id)),
    random,
  );

  const picked: Song[] = [];
  const artists = new Set<string>();
  const leftovers: Song[] = [];
  for (const song of [...fresh, ...heard]) {
    if (picked.length === count) break;
    if (artists.has(song.artist)) {
      leftovers.push(song);
      continue;
    }
    artists.add(song.artist);
    picked.push(song);
  }
  return [...picked, ...leftovers].slice(0, count);
}

/** Songs for one game, with preview URLs fetched fresh from iTunes. */
export async function pickSongs(count: number, excludeIds: readonly number[]): Promise<Song[]> {
  return refreshPreviews(chooseSongs(count, excludeIds));
}

export function catalogSize(): number {
  return SONGS.length;
}
