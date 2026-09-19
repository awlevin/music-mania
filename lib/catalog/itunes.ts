import type { Song } from '@/lib/game/types';

const LOOKUP = 'https://itunes.apple.com/lookup';
const TIMEOUT_MS = 2500;

interface LookupResult {
  trackId?: number;
  previewUrl?: string;
}

/**
 * Apple re-encodes previews now and then, which changes their URLs. One batch
 * lookup per game gets the current ones. iTunes allows about 20 calls a
 * minute; if it refuses or stalls, the URLs stored in the catalog still play.
 */
export async function refreshPreviews(songs: Song[]): Promise<Song[]> {
  if (songs.length === 0) return songs;
  try {
    const url = `${LOOKUP}?id=${songs.map((s) => s.id).join(',')}&entity=song&country=US`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
    if (!res.ok) return songs;
    const body = (await res.json()) as { results?: LookupResult[] };
    const fresh = new Map<number, string>();
    for (const r of body.results ?? []) {
      if (r.trackId && r.previewUrl) fresh.set(r.trackId, r.previewUrl);
    }
    return songs.map((s) => ({ ...s, previewUrl: fresh.get(s.id) ?? s.previewUrl }));
  } catch {
    return songs;
  }
}
