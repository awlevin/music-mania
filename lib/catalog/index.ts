// Where songs come from. Today the catalog is a JSON file in the repo; the
// plan (docs/ROADMAP.md) is to move it to a database that grows as people
// play. Everything outside this folder goes through `pickSongs`, so that move
// touches nothing else.

import catalog from '@/data/catalog.json';
import finales from '@/data/finales.json';
import lobby from '@/data/lobby.json';
import type { Song } from '@/lib/game/types';

import { refreshPreviews } from './itunes';

const SONGS = catalog as Song[];
/** Party songs for the final scores: "Celebration" and friends. One plays per game. */
const FINALES = finales as Song[];

/** "Queen & David Bowie" and "Queen" are the same act as far as variety goes. */
function primaryArtist(artist: string): string {
  return artist
    .split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b)\s*/i)[0]
    .trim()
    .toLowerCase();
}

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
    const artist = primaryArtist(song.artist);
    if (artists.has(artist)) {
      leftovers.push(song);
      continue;
    }
    artists.add(artist);
    picked.push(song);
  }
  return [...picked, ...leftovers].slice(0, count);
}

/** Songs for one game and the finale, with preview URLs fetched fresh from iTunes. */
export async function pickSongs(
  count: number,
  excludeIds: readonly number[],
  lastFinaleId?: number,
): Promise<{ songs: Song[]; finale: Song | null }> {
  const chosen = chooseSongs(count, excludeIds);
  const finale = chooseFinale(chosen, lastFinaleId);
  const fresh = await refreshPreviews(finale ? [...chosen, finale] : chosen);
  return { songs: fresh.slice(0, chosen.length), finale: finale ? fresh[fresh.length - 1] : null };
}

/** "Feel It Still", for the lobby, with a fresh preview URL. */
export async function lobbySong(): Promise<Song> {
  return (await refreshPreviews([lobby as Song]))[0];
}

/** A finale this game did not ask about and the last game did not end on. */
export function chooseFinale(
  questions: readonly Song[],
  lastFinaleId?: number,
  random: () => number = Math.random,
): Song | null {
  const asked = new Set(questions.map((s) => s.id));
  const unasked = FINALES.filter((s) => !asked.has(s.id));
  const fresh = unasked.filter((s) => s.id !== lastFinaleId);
  const pool = fresh.length ? fresh : unasked;
  return pool.length ? pool[Math.floor(random() * pool.length)] : null;
}

export function catalogSize(): number {
  return SONGS.length;
}
