// The album rounds are the hard ones, so they are not drawn cold. At start the
// room gets a pool of reprises: one more song by each artist heard in the
// early rounds. Just before the album rounds, this picks from that pool by who
// got what right, so the album questions go to artists people in the room
// have already shown they know, and so that more than one person gets a shot.

import { leadArtist } from './match';
import type { Round, Song } from './types';

/** A year this close counts as knowing the song. */
const NEAR_YEARS = 2;

/** The players who showed they know this round's artist. */
export function knowers(round: Round): string[] {
  return Object.entries(round.answers)
    .filter(
      ([, a]) =>
        a.correct || (round.kind === 'year' && a.yearsOff !== undefined && a.yearsOff <= NEAR_YEARS),
    )
    .map(([playerId]) => playerId);
}

/**
 * One song per album round, from `pool`, or null to keep the song drawn at
 * start. `heard` is the rounds already played.
 *
 * The first pick goes to the artist known by the most players. Each pick
 * after that goes to a different artist, the one known by the most players
 * not yet covered by an earlier pick, so a second album round is a shot for
 * someone else rather than another lap for the leader. Ties go to the artist
 * more players know, then to pool order. Artists nobody got right stay out.
 */
export function pickReprises(
  heard: readonly Round[],
  pool: readonly Song[],
  slots: number,
  playerIds: readonly string[],
): (Song | null)[] {
  const present = new Set(playerIds);
  const known = new Map<string, Set<string>>();
  for (const round of heard) {
    const artist = leadArtist(round.song.artist);
    const players = known.get(artist) ?? new Set<string>();
    for (const id of knowers(round)) if (present.has(id)) players.add(id);
    known.set(artist, players);
  }

  const candidates = new Map<string, Song[]>();
  for (const song of pool) {
    const artist = leadArtist(song.artist);
    if (!known.get(artist)?.size) continue;
    candidates.set(artist, [...(candidates.get(artist) ?? []), song]);
  }

  const covered = new Set<string>();
  const picks: (Song | null)[] = [];
  for (let slot = 0; slot < slots; slot++) {
    let best: { artist: string; gain: number; size: number } | null = null;
    for (const artist of candidates.keys()) {
      const players = known.get(artist)!;
      const gain = [...players].filter((id) => !covered.has(id)).length;
      if (!best || gain > best.gain || (gain === best.gain && players.size > best.size)) {
        best = { artist, gain, size: players.size };
      }
    }
    if (!best) {
      picks.push(null);
      continue;
    }
    picks.push(candidates.get(best.artist)![0]);
    candidates.delete(best.artist);
    for (const id of known.get(best.artist)!) covered.add(id);
  }
  return picks;
}
