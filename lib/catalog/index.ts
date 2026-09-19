// Where songs come from. Today the catalog is a JSON file in the repo; the
// plan (docs/ROADMAP.md) is to move it to a database that grows as people
// play. Everything outside this folder goes through `pickSongs`, so that move
// touches nothing else.

import catalog from '@/data/catalog.json';
import finales from '@/data/finales.json';
import lobby from '@/data/lobby.json';
import { benchedSongIds } from '@/lib/feedback/store';
import { decadeOf } from '@/lib/game/decades';
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
 * `count` songs this room has not heard, no artist twice. Only when the
 * catalog runs dry does it repeat, and then the songs heard longest ago come
 * first. `excludeIds` is oldest first.
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
  const lastHeard = new Map(excludeIds.map((id, i) => [id, i]));
  const heard = songs
    .filter((s) => exclude.has(s.id))
    .sort((a, b) => lastHeard.get(a.id)! - lastHeard.get(b.id)!);

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

/** The songs from the given decades (start years: 2010 for the 2010s). */
export function fromDecades(songs: readonly Song[], decades: readonly number[]): Song[] {
  const wanted = new Set(decades);
  return songs.filter((s) => wanted.has(decadeOf(s.year)));
}

/**
 * Songs for one game and the finale, exactly as a room draws them, but with
 * the preview URLs still as stored. The shuffle preview page uses this to
 * show what a game would have played without a trip to iTunes. Without
 * `decades` the whole catalog is in play.
 */
export async function drawSongs(
  count: number,
  excludeIds: readonly number[],
  lastFinaleId?: number,
  decades?: readonly number[],
): Promise<{ songs: Song[]; finales: Song[] }> {
  // Songs someone has reported sit out until the report is closed.
  const benched = new Set(await benchedSongIds().catch(() => []));
  const playable = SONGS.filter((s) => !benched.has(s.id));
  const inPlay = decades ? fromDecades(playable, decades) : playable;
  // A decade that has been reported down to nothing falls back to the whole catalog.
  const pool = inPlay.length >= count ? inPlay : playable;
  const songs = chooseSongs(count, excludeIds, Math.random, pool);
  return { songs, finales: chooseFinales(songs, lastFinaleId) };
}

/** Songs for one game and the finale, with preview URLs fetched fresh from iTunes. */
export async function pickSongs(
  count: number,
  excludeIds: readonly number[],
  lastFinaleId?: number,
  decades?: readonly number[],
): Promise<{ songs: Song[]; finales: Song[] }> {
  const { songs, finales } = await drawSongs(count, excludeIds, lastFinaleId, decades);
  const fresh = await refreshPreviews([...songs, ...finales]);
  return { songs: fresh.slice(0, songs.length), finales: fresh.slice(songs.length) };
}

/** "Feel It Still", for the lobby, with a fresh preview URL. */
export async function lobbySong(): Promise<Song> {
  return (await refreshPreviews([lobby as Song]))[0];
}

/**
 * The party songs for the final scores, shuffled: none that this game asked
 * about, and not opening on the one the last game opened on.
 */
export function chooseFinales(
  questions: readonly Song[],
  lastFinaleId?: number,
  random: () => number = Math.random,
): Song[] {
  const asked = new Set(questions.map((s) => s.id));
  const order = shuffle(
    FINALES.filter((s) => !asked.has(s.id)),
    random,
  );
  if (order.length > 1 && order[0].id === lastFinaleId) order.push(order.shift()!);
  return order;
}
