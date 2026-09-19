#!/usr/bin/env node
// Reproducible catalog builder for the music-mania "name that tune" game.
// Plain ESM, no dependencies, requires Node 22+ (global fetch).
//
// catalog-seed.json is the source of truth. Every entry is hand written from
// music knowledge and resolved against the free iTunes Search API:
//
//   {
//     "artist": "Daryl Hall & John Oates",  // as the catalog should show it
//     "title":  "Rich Girl",                // clean title, no version labels
//     "album":  "Bigger Than Both of Us",   // the ORIGINAL studio album
//     "year":   1976,                       // the song's original release year
//     "bucket": "1970s:top",                // "<decade>s:<slice>" for coverage
//     "albumAlt":  ["..."],                 // optional: other album spellings
//     "artistAlt": ["..."],                 // optional: how iTunes bills them
//     "query":     "..."                    // optional: override the search
//   }
//
// Usage:
//   node build-catalog.mjs precheck          # seed-only checks, no network
//   node build-catalog.mjs resolve           # resolve every unresolved seed
//   node build-catalog.mjs resolve --watch   # keep going while the seed grows
//   node build-catalog.mjs resolve --force   # ignore the cache, re-fetch
//   node build-catalog.mjs resolve --only="Queen|Under Pressure,ABBA|SOS"
//   node build-catalog.mjs merge             # seed + resolved -> catalog.json
//   node build-catalog.mjs report            # counts per decade and per bucket
//   node build-catalog.mjs validate [--no-head]
//
// `merge` writes scripts/catalog.json; copy it over data/catalog.json once
// `validate` is clean.
//
// The search API allows roughly 20 requests a minute, so every response is
// cached on disk and a re-run never re-fetches. A full build of ~1,200 songs
// takes about an hour of wall time; run it in the background.
//
// Files (all next to this script unless noted):
//   catalog-seed.json     input seed list
//   cache/*.json          one cached iTunes response per query
//   resolved.json         map of "<artist>|<title>" -> resolved catalog entry
//   misses.json           seed entries that could not be resolved
//   catalog.json          output of `merge`
//   ../data/catalog.json  pinned: songs already shipped keep their exact
//                         trackId and urls and are never re-fetched
//   seed-complete.flag    presence lets `resolve --watch` stop when done

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(__dirname, 'catalog-seed.json');
const CACHE_DIR = path.join(__dirname, 'cache');
const RESOLVED_PATH = path.join(__dirname, 'resolved.json');
const MISSES_PATH = path.join(__dirname, 'misses.json');
const CATALOG_PATH = path.join(__dirname, 'catalog.json');
const PIN_PATH = path.join(__dirname, '..', 'data', 'catalog.json');
const DONE_FLAG = path.join(__dirname, 'seed-complete.flag');

const SLEEP_MS = 3600; // ~16-17 req/min, under the ~20/min limit
const BACKOFF_MS = 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- normalization / matching helpers ----

const SYMBOL_WORDS = [
  [/÷/g, ' divide '],
  [/×/g, ' multiply '],
  [/\+/g, ' plus '],
  [/=/g, ' equals '],
];

function normalize(str) {
  let s = (str || '').toLowerCase();
  for (const [re, word] of SYMBOL_WORDS) s = s.replace(re, word);
  s = s.replace(/([a-z])!([a-z])/gi, '$1i$2'); // P!nk -> Pink
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^the\s+/, '')
    .trim()
    .replace(/\s+/g, ' ');
}

const normalizeTight = (s) => normalize(s).replace(/\s+/g, '');

export function keyFor(artist, title) {
  return `${normalize(artist)}|${normalize(title)}`;
}

const EDITION_RE =
  /\s*[([][^)\]]*\b(deluxe|remaster(ed)?|edition|version|anniversary|bonus track|expanded|special|re-?issue|super deluxe|legacy|repackage|mono|stereo|\d{4})\b[^)\]]*[)\]]/gi;

// Regex edition stripping can leave a stray unmatched bracket behind when the
// source has nested parens; drop any bracket with no partner.
function dropUnbalancedBrackets(str) {
  let depth = 0;
  let out = '';
  for (const ch of str) {
    if (ch === '(' || ch === '[') {
      depth++;
      out += ch;
    } else if (ch === ')' || ch === ']') {
      if (depth > 0) {
        depth--;
        out += ch;
      }
    } else {
      out += ch;
    }
  }
  return out;
}

export function stripEditionSuffix(name) {
  if (!name) return name;
  let out = name.replace(EDITION_RE, '');
  out = out.replace(
    /\s*[-–—]\s*(single version|radio edit|remaster(ed)?.*|bonus track.*|\d{4} remaster.*|mono.*|stereo.*)$/i,
    '',
  );
  out = out.replace(/\s*[([](feat|featuring|with)\.?[^)\]]*[)\]]/gi, '');
  out = out.replace(/\s+the\s+remaster(ed)?$/i, '');
  out = out.replace(/\s+remaster(ed)?$/i, '');
  out = dropUnbalancedBrackets(out);
  return out.trim().replace(/\s+/g, ' ');
}

// A "version marker" is a word describing an alternate recording. It only
// counts inside a bracketed suffix or after a dash, which keeps real titles
// ("Live and Let Die", "Live Forever", "All My Ex's Live in Texas") clean.
//
// HARD markers mean a different recording: never acceptable.
// SOFT markers ("(Single Version)", "- 2011 Remaster") are the same recording
// wearing a label. They are accepted only when nothing cleaner exists, and the
// stored title always comes from the seed, so the label never ships.
const HARD_WORDS = [
  'live',
  'remix',
  'karaoke',
  'instrumental',
  'tribute',
  'cover',
  'acoustic',
  'demo',
  'rerecorded',
  're-recorded',
  'a cappella',
  'acapella',
  'reprise',
  'unplugged',
  'session',
  'sessions',
  'rehearsal',
  'outtake',
  'sped up',
  'slowed',
  'alternate',
  'rework',
  'medley',
  'workout',
];

const SOFT_WORDS = [
  'version',
  'remaster',
  'remastered',
  'mono',
  'stereo',
  'anniversary',
  'single',
  'edit',
  'mix',
  'original',
  'radio',
  'album',
  'pt',
  'pts',
  'part',
];

function versionSegments(title) {
  const t = title || '';
  const segs = [...t.matchAll(/[([]([^)\]]*)[)\]]/g)].map((m) => m[1]);
  const dash = t.match(/\s[-–—]\s+(.+)$/);
  if (dash) segs.push(dash[1]);
  return segs;
}

export function hasVersionMarker(title) {
  const t = title || '';
  if (segmentHasWord(t, HARD_WORDS)) return true;
  // "- Live at Wembley" / "(Live in Paris)": only a dash or bracket makes the
  // word a version marker, so "All My Ex's Live in Texas" stays clean.
  if (/[-–—([]\s*live\s+(at|from|in|on|version|session)\b/i.test(t)) return true;
  if (/\bkaraoke\b|\bmade famous by\b|\btribute to\b|\bin the style of\b/i.test(t)) return true;
  return false;
}

function segmentHasWord(text, words) {
  const re = new RegExp(`\\b(${words.join('|').replace(/ /g, '\\s')})\\b`, 'i');
  // "(Are Made of This)" / "(Put a Ring on It)" are part of the real title,
  // so only bracketed or dashed segments are inspected.
  return versionSegments(text || '').some((seg) => re.test(seg));
}

export function hasSoftVersionMarker(title) {
  return segmentHasWord(title, SOFT_WORDS);
}

// An album that is itself an alternate recording of the real album.
function isAltAlbum(album) {
  const a = stripEditionSuffix(album || '');
  if (hasVersionMarker(a)) return true;
  if (/^live\s*[!:.]/i.test(a) || /^live$/i.test(a)) return true;
  if (/\blive\s+(at|in|from|on)\b/i.test(a)) return true;
  if (/\b(unplugged|karaoke|tribute|remixes?|acoustic)\b/i.test(a)) return true;
  return false;
}

function artistMatches(expected, candidate) {
  const e = normalize(expected);
  const c = normalize(candidate);
  if (!e || !c) return false;
  if (e === c) return true;
  if (normalizeTight(expected) === normalizeTight(candidate)) return true;
  if (c.startsWith(`${e} `) || e.startsWith(`${c} `)) return true;
  if (c.includes(` ${e} `) || c.endsWith(` ${e}`)) return true;
  return false;
}

function baseTitle(title) {
  let t = stripEditionSuffix(title || '');
  t = t.replace(/\s*[([](feat|featuring|with)\.?[^)\]]*[)\]]/gi, '');
  t = t.replace(/\s*[-–—]\s*(feat|featuring|with)\.?\s.*$/i, '');
  return t.trim();
}

function titleNames(seed) {
  return [seed.title, ...(seed.titleAlt || [])];
}

function titleMatches(expected, candidate) {
  const e = normalize(baseTitle(expected));
  const c = normalize(baseTitle(candidate));
  if (!e || !c) return false;
  if (e === c) return true;
  if (normalizeTight(baseTitle(expected)) === normalizeTight(baseTitle(candidate))) return true;
  // Allow the API to carry a parenthetical the seed omits, or vice versa,
  // but only when the shared prefix is the whole of the shorter title.
  if (c.startsWith(`${e} `) || e.startsWith(`${c} `)) return true;
  return false;
}

const COMPILATION_RE =
  /\b(greatest hits|the hits|number ones|no\. 1's|anthology|essential|now that's|ultimate|best of|very best|collection|singles|icon|20th century masters|playlist)\b/i;

// "Gold" and "Icon" name compilation series on their own, but they are also
// words inside real album names ("Mellow Gold"), so they only count alone.
const COMPILATION_EXACT = new Set(['gold', 'icon', 'playlist', 'hits', 'classics']);

const isCompilationAlbum = (a) =>
  COMPILATION_RE.test(a || '') || COMPILATION_EXACT.has(normalize(stripEditionSuffix(a || '')));

// quality 0 = no match, 1 = matched only after a subtitle/prefix fallback (use
// our curated album name), 2 = clean match (trust the API's casing/accents).
function matchAlbum(expectedAlbum, candidateAlbum) {
  if (isCompilationAlbum(candidateAlbum)) return { quality: 0 };
  const expNorm = normalize(expectedAlbum);
  const candNorm = normalize(candidateAlbum);
  const stripped = stripEditionSuffix(candidateAlbum);
  const candStrippedNorm = normalize(stripped);
  if (!expNorm || !candNorm) return { quality: 0 };
  if (expNorm === candNorm) return { quality: 2, cleanAlbum: candidateAlbum };
  if (expNorm === candStrippedNorm) return { quality: 2, cleanAlbum: stripped };
  // "19 Naughty III" vs iTunes' "19Naughtyiii"
  if (normalizeTight(expectedAlbum) === normalizeTight(stripped)) {
    return { quality: 2, cleanAlbum: expectedAlbum };
  }
  if (candStrippedNorm.startsWith(`${expNorm} `)) return { quality: 1, cleanAlbum: expectedAlbum };
  if (expNorm.startsWith(`${candStrippedNorm} `)) return { quality: 1, cleanAlbum: expectedAlbum };
  return { quality: 0 };
}

function albumCandidates(seed) {
  return [seed.album, ...(seed.albumAlt || [])];
}

// iTunes bills some acts differently from how people name them
// ("Daryl Hall & John Oates", "John Cougar"), so a seed can list aliases.
function artistNames(seed) {
  return [seed.artist, ...(seed.artistAlt || [])];
}

export function pickBestCandidate(seed, results) {
  const candidates = (results || []).filter(
    (r) =>
      r.kind === 'song' &&
      r.previewUrl &&
      r.trackId &&
      !hasVersionMarker(r.trackName) &&
      !isAltAlbum(r.collectionName) &&
      artistNames(seed).some((a) => artistMatches(a, r.artistName)) &&
      titleNames(seed).some((t) => titleMatches(t, r.trackName)),
  );

  let best = null;
  let bestCleanAlbum = null;
  let bestScore = -1;
  for (const c of candidates) {
    let quality = 0;
    let cleanAlbum = null;
    for (const expected of albumCandidates(seed)) {
      const m = matchAlbum(expected, c.collectionName);
      if (m.quality > quality) {
        quality = m.quality;
        cleanAlbum = m.cleanAlbum;
      }
    }
    if (quality === 0) continue;
    const cleanTitle = hasSoftVersionMarker(c.trackName) ? 0 : 0.5;
    const cleanCollection = hasSoftVersionMarker(c.collectionName) ? 0 : 0.2;
    const exactTitle = normalize(c.trackName) === normalize(seed.title) ? 0.25 : 0;
    const score = quality + cleanTitle + cleanCollection + exactTitle;
    if (score > bestScore) {
      bestScore = score;
      best = c;
      bestCleanAlbum = cleanAlbum;
    }
  }
  return best ? { track: best, cleanAlbum: bestCleanAlbum } : null;
}

// ---- network ----

function cacheKeyFor(query) {
  const hash = createHash('sha1').update(query).digest('hex').slice(0, 16);
  const safe = query.replace(/[^a-z0-9]+/gi, '_').slice(0, 60);
  return `${safe}_${hash}.json`;
}

let fetchedThisRun = 0;

async function fetchWithCache(query, { force = false } = {}) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
    query,
  )}&entity=song&country=US&limit=25`;
  return fetchJson(url, query, { force });
}

// The search index omits explicit tracks, so an explicit song ("American
// Idiot", "Killing in the Name") is invisible there even though its album is
// on the store. The album's own track list does include it, so a miss falls
// back to: find the album's collectionId via a clean track, then look the
// album up and take the track by name.
async function fetchAlbumTracks(collectionId, { force = false } = {}) {
  const url = `https://itunes.apple.com/lookup?id=${collectionId}&entity=song&country=US&limit=200`;
  return fetchJson(url, `lookup:${collectionId}`, { force });
}

async function fetchJson(url, cacheKey, { force = false } = {}) {
  await mkdir(CACHE_DIR, { recursive: true });
  const cacheFile = path.join(CACHE_DIR, cacheKeyFor(cacheKey));

  if (!force) {
    try {
      return JSON.parse(await readFile(cacheFile, 'utf8'));
    } catch {
      /* not cached yet */
    }
  }

  let attempt = 0;
  while (true) {
    attempt += 1;
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': 'music-mania-catalog-builder/1.0' } });
    } catch (err) {
      if (attempt >= 5) throw err;
      console.warn(`  [network error] ${err.message} — retrying in ${BACKOFF_MS}ms`);
      await sleep(BACKOFF_MS);
      continue;
    }
    if (res.status === 403 || res.status === 429 || res.status >= 500) {
      console.warn(
        `  [rate-limited] status=${res.status} key="${cacheKey}" — backing off ${BACKOFF_MS}ms (attempt ${attempt})`,
      );
      await sleep(BACKOFF_MS);
      if (attempt >= 6) throw new Error(`Giving up on "${cacheKey}" after ${attempt} attempts`);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for "${cacheKey}"`);
    const json = await res.json();
    await writeFile(cacheFile, JSON.stringify(json, null, 2));
    fetchedThisRun += 1;
    return json;
  }
}

// Collect the collectionIds of albums that match what the seed asks for,
// from any search result (the album's clean tracks are enough to find it).
function albumIdsFrom(seed, results) {
  const wanted = [];
  for (const r of results || []) {
    if (!r.collectionId || r.kind !== 'song') continue;
    if (!artistNames(seed).some((a) => artistMatches(a, r.artistName))) continue;
    if (isAltAlbum(r.collectionName)) continue;
    for (const expected of albumCandidates(seed)) {
      const m = matchAlbum(expected, r.collectionName);
      if (m.quality > 0 && !wanted.some((w) => w.collectionId === r.collectionId)) {
        wanted.push({ collectionId: r.collectionId, quality: m.quality, cleanAlbum: m.cleanAlbum });
      }
    }
  }
  return wanted.sort((a, b) => b.quality - a.quality).slice(0, 3);
}

async function resolveViaAlbum(seed, results, { force = false } = {}) {
  let albums = albumIdsFrom(seed, results);
  if (albums.length === 0) {
    // Nothing in the song search pointed at the album; search for the album
    // by name, which surfaces its other (clean) tracks.
    const albumQuery = `${seed.artist} ${seed.album}`;
    const json = await fetchWithCache(albumQuery, { force });
    await sleep(SLEEP_MS);
    albums = albumIdsFrom(seed, json.results || []);
  }
  for (const album of albums) {
    const json = await fetchAlbumTracks(album.collectionId, { force });
    await sleep(SLEEP_MS);
    const tracks = (json.results || []).filter((r) => r.wrapperType === 'track');
    const picked = pickBestCandidate(seed, tracks.map((t) => ({ ...t, kind: t.kind || 'song' })));
    if (picked) return picked;
  }
  return null;
}

// ---- io helpers ----

const readJson = async (p, fallback) => {
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch {
    return fallback;
  }
};

const exists = async (p) => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};

async function loadSeeds() {
  const seeds = await readJson(SEED_PATH, null);
  if (!Array.isArray(seeds)) throw new Error(`Cannot read seed list at ${SEED_PATH}`);
  return seeds;
}

async function loadPins() {
  const pinned = await readJson(PIN_PATH, []);
  const map = new Map();
  for (const entry of pinned) map.set(keyFor(entry.artist, entry.title), entry);
  return map;
}

// ---- commands ----

async function cmdPrecheck() {
  const seeds = await loadSeeds();
  const seen = new Map();
  const perArtist = new Map();
  const problems = [];
  for (const [i, s] of seeds.entries()) {
    for (const f of ['artist', 'title', 'album', 'year', 'bucket']) {
      if (s[f] === undefined || s[f] === '') problems.push(`#${i} missing ${f}: ${JSON.stringify(s)}`);
    }
    const k = keyFor(s.artist, s.title);
    if (seen.has(k)) problems.push(`duplicate (artist,title): ${s.artist} - ${s.title} (#${seen.get(k)} and #${i})`);
    else seen.set(k, i);
    const a = normalize(s.artist);
    perArtist.set(a, (perArtist.get(a) || 0) + 1);
    if (!/^(19[5-9]\d|20[0-2]\d)$/.test(String(s.year))) problems.push(`#${i} bad year ${s.year} for ${s.artist} - ${s.title}`);
    const decade = `${Math.floor(s.year / 10) * 10}s`;
    if (s.bucket && !s.bucket.startsWith(`${decade}:`)) {
      problems.push(`#${i} bucket ${s.bucket} disagrees with year ${s.year} (${s.artist} - ${s.title})`);
    }
    if (hasVersionMarker(s.title)) problems.push(`#${i} title has a version marker: ${s.title}`);
  }
  for (const [a, n] of perArtist) if (n > 4) problems.push(`artist over cap (${n}): ${a}`);

  console.log(`seeds: ${seeds.length}`);
  if (problems.length) {
    console.log(`\nPROBLEMS (${problems.length}):`);
    for (const p of problems) console.log(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log('precheck OK');
  }
}

async function cmdResolve(args) {
  const force = args.includes('--force');
  const watch = args.includes('--watch');
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const only = onlyArg
    ? new Set(onlyArg.slice('--only='.length).split(',').map((s) => {
        const [artist, title] = s.split('|');
        return keyFor(artist, title);
      }))
    : null;

  const resolved = await readJson(RESOLVED_PATH, {});
  const pins = await loadPins();

  let idle = 0;
  while (true) {
    const seeds = await loadSeeds();
    const todo = seeds.filter((s) => {
      const k = keyFor(s.artist, s.title);
      if (only && !only.has(k)) return false;
      if (pins.has(k) && !force) return false;
      return force ? true : !resolved[k];
    });

    if (todo.length === 0) {
      if (!watch) break;
      if (await exists(DONE_FLAG)) break;
      idle += 1;
      if (idle > 240) break; // ~80 min with nothing new: stop waiting
      await sleep(20_000);
      continue;
    }
    idle = 0;
    let resolvedThisPass = 0;

    for (const [n, seed] of todo.entries()) {
      const k = keyFor(seed.artist, seed.title);
      if (!force && resolved[k]) continue;
      const query = seed.query || `${seed.artist} ${seed.title}`;
      console.log(`[${n + 1}/${todo.length}] ${seed.artist} - ${seed.title}`);
      let json;
      const before = fetchedThisRun;
      try {
        json = await fetchWithCache(query, { force });
      } catch (err) {
        console.error(`  ERROR fetching: ${err.message}`);
        await sleep(SLEEP_MS);
        continue;
      }
      let picked = pickBestCandidate(seed, json.results || []);
      if (!picked) {
        try {
          picked = await resolveViaAlbum(seed, json.results || [], { force });
        } catch (err) {
          console.error(`  ERROR in album fallback: ${err.message}`);
        }
        if (picked) console.log('  (found via album track list)');
      }
      if (!picked) {
        console.warn('  MISS');
      } else {
        const { track, cleanAlbum } = picked;
        resolved[k] = {
          id: track.trackId,
          title: seed.title,
          artist: seed.artist,
          album: cleanAlbum,
          year: seed.year,
          genre: track.primaryGenreName,
          artworkUrl: (track.artworkUrl100 || '').replace('100x100bb', '600x600bb'),
          previewUrl: track.previewUrl,
        };
        console.log(`  OK -> album="${cleanAlbum}" id=${track.trackId}`);
        resolvedThisPass += 1;
        await writeFile(RESOLVED_PATH, JSON.stringify(resolved, null, 2));
      }
      if (fetchedThisRun > before) await sleep(SLEEP_MS); // cache hits are free
    }
    await writeFile(RESOLVED_PATH, JSON.stringify(resolved, null, 2));
    if (!watch) break;
    // A pass that resolves nothing new would just spin over the same misses.
    if (resolvedThisPass === 0 && (await exists(DONE_FLAG))) break;
    await sleep(10_000);
  }

  await writeFile(RESOLVED_PATH, JSON.stringify(resolved, null, 2));
  const seeds = await loadSeeds();
  const misses = seeds.filter((s) => {
    const k = keyFor(s.artist, s.title);
    return !pins.has(k) && !resolved[k];
  });
  await writeFile(MISSES_PATH, JSON.stringify(misses, null, 2));
  console.log(`\nresolved: ${Object.keys(resolved).length}  pinned: ${pins.size}  misses: ${misses.length}`);
}

async function cmdMerge() {
  const seeds = await loadSeeds();
  const resolved = await readJson(RESOLVED_PATH, {});
  const pins = await loadPins();
  const out = [];
  const missing = [];
  const seenIds = new Set();
  const seenKeys = new Set();
  for (const seed of seeds) {
    const k = keyFor(seed.artist, seed.title);
    const found = pins.get(k) || resolved[k];
    // The seed is the source of truth for the three fields we curate by hand;
    // the id, album, genre and urls come from the resolved iTunes track.
    // A CJK/Hangul album name is unanswerable in a typing game, so those keep
    // the seed's Latin spelling ("Love Yourself: Tear").
    const CJK = /[\u1100-\u11FF\u2E80-\u9FFF\uAC00-\uD7AF]/;
    const entry = found && {
      ...found,
      title: seed.title,
      artist: seed.artist,
      album: CJK.test(found.album || '') ? seed.album : found.album,
      year: seed.year,
    };
    if (!entry) {
      missing.push(`${seed.artist} - ${seed.title} (${seed.bucket})`);
      continue;
    }
    if (seenKeys.has(k)) continue;
    if (seenIds.has(entry.id)) {
      missing.push(`${seed.artist} - ${seed.title} — duplicate trackId ${entry.id}`);
      continue;
    }
    seenKeys.add(k);
    seenIds.add(entry.id);
    out.push(entry);
  }
  await writeFile(CATALOG_PATH, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`wrote ${CATALOG_PATH} with ${out.length} songs (${missing.length} unresolved)`);
  for (const m of missing.slice(0, 50)) console.log(`  missing: ${m}`);
}

// `merge` writes CATALOG_PATH; once it has been copied into data/, that copy
// is what report and validate should read.
async function targetFile(args) {
  const fileArg = args.find((a) => a.startsWith('--file='));
  if (fileArg) return path.resolve(fileArg.slice('--file='.length));
  return (await exists(CATALOG_PATH)) ? CATALOG_PATH : PIN_PATH;
}

async function cmdReport(args) {
  const file = await targetFile(args);
  const catalog = await readJson(file, []);
  const seeds = await loadSeeds();
  const bucketByKey = new Map(seeds.map((s) => [keyFor(s.artist, s.title), s.bucket]));

  const perDecade = new Map();
  const perBucket = new Map();
  for (const s of catalog) {
    const d = `${Math.floor(s.year / 10) * 10}s`;
    perDecade.set(d, (perDecade.get(d) || 0) + 1);
    const b = bucketByKey.get(keyFor(s.artist, s.title)) || 'unassigned';
    perBucket.set(b, (perBucket.get(b) || 0) + 1);
  }
  console.log(`total: ${catalog.length}\n`);
  console.log('per decade:');
  for (const d of [...perDecade.keys()].sort()) console.log(`  ${d}: ${perDecade.get(d)}`);
  console.log('\nper bucket:');
  for (const b of [...perBucket.keys()].sort()) console.log(`  ${b}: ${perBucket.get(b)}`);
}

const ALBUM_BANNED =
  /\b(greatest|hits|best of|essential|collection|anthology|now that's|deluxe|remaster(ed)?|version|edition)\b/i;

async function headOk(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.status;
  } catch (err) {
    return `ERR ${err.message}`;
  }
}

async function cmdValidate(args) {
  const file = await targetFile(args);
  const catalog = await readJson(file, null);
  if (!Array.isArray(catalog)) throw new Error(`cannot read catalog at ${file}`);
  const problems = [];
  const warnings = [];

  const ids = new Set();
  const keys = new Set();
  const perArtist = new Map();
  for (const s of catalog) {
    if (!Number.isInteger(s.id)) problems.push(`non-integer id: ${s.artist} - ${s.title}`);
    if (ids.has(s.id)) problems.push(`duplicate id ${s.id}: ${s.artist} - ${s.title}`);
    ids.add(s.id);
    const k = keyFor(s.artist, s.title);
    if (keys.has(k)) problems.push(`duplicate (artist,title): ${s.artist} - ${s.title}`);
    keys.add(k);
    const a = normalize(s.artist);
    perArtist.set(a, (perArtist.get(a) || 0) + 1);
    if (!Number.isInteger(s.year) || s.year < 1955 || s.year > 2026) problems.push(`bad year ${s.year}: ${s.artist} - ${s.title}`);
    if (ALBUM_BANNED.test(s.album || '')) problems.push(`album marker: "${s.album}" (${s.artist} - ${s.title})`);
    if (hasVersionMarker(s.title)) problems.push(`title version marker: "${s.title}" (${s.artist})`);
    if (hasVersionMarker(s.album)) problems.push(`album version marker: "${s.album}" (${s.artist})`);
    for (const f of ['title', 'artist', 'album', 'genre', 'artworkUrl', 'previewUrl']) {
      if (!s[f]) problems.push(`missing ${f}: ${s.artist} - ${s.title}`);
    }
    if (s.previewUrl && !/^https:\/\//.test(s.previewUrl)) problems.push(`bad previewUrl: ${s.artist} - ${s.title}`);
    // iTunes sometimes shouts an album name. Stylized titles (BRAT, GUTS,
    // BORN PINK) are real, so this is a warning to eyeball, not a failure.
    const shouted = (s.album || '').split(/\s+/).filter((w) => /^[A-Z]{4,}$/.test(w));
    if (shouted.length >= 2) warnings.push(`ALL-CAPS album? "${s.album}" (${s.artist} - ${s.title})`);
  }
  for (const [a, n] of perArtist) if (n > 4) problems.push(`artist over cap (${n}): ${a}`);

  // every id that shipped before must still be present
  const pins = await readJson(PIN_PATH, []);
  const pinIds = new Set(pins.map((p) => p.id));
  if (path.resolve(file) !== path.resolve(PIN_PATH)) {
    for (const id of pinIds) if (!ids.has(id)) problems.push(`previously shipped id missing: ${id}`);
  }

  // The single most valuable check: does each trackId really point at this
  // song? A matcher that compares only the album will happily grab the wrong
  // track from the right record, and nothing else here would notice.
  if (!args.includes('--no-lookup')) {
    console.log(`looking up ${catalog.length} track ids...`);
    const byId = new Map(catalog.map((e) => [e.id, e]));
    const seedByKey = new Map(
      (await readJson(SEED_PATH, [])).map((x) => [keyFor(x.artist, x.title), x]),
    );
    const ids = catalog.map((e) => e.id);
    for (let i = 0; i < ids.length; i += 20) {
      const batch = ids.slice(i, i + 20);
      let json;
      try {
        json = await fetchJson(
          `https://itunes.apple.com/lookup?id=${batch.join(',')}&country=US`,
          `audit:${batch[0]}:${batch.length}`,
        );
      } catch (err) {
        problems.push(`lookup failed for ids ${batch[0]}...: ${err.message}`);
        continue;
      }
      const seen = new Set();
      for (const r of json.results || []) {
        const e = byId.get(r.trackId);
        if (!e) continue;
        seen.add(r.trackId);
        const got = normalize(baseTitle(r.trackName));
        const gotTight = normalizeTight(baseTitle(r.trackName));
        const seed = seedByKey.get(keyFor(e.artist, e.title));
        const wants = [e.title, ...((seed && seed.titleAlt) || [])];
        const sameSong = wants.some((w) => {
          const want = normalize(baseTitle(w));
          const wantTight = normalizeTight(baseTitle(w));
          return (
            want === got ||
            got.startsWith(`${want} `) ||
            want.startsWith(`${got} `) ||
            // "(You Gotta) Fight for Your Right (To Party)" vs "Fight for Your Right"
            wantTight.includes(gotTight) ||
            gotTight.includes(wantTight)
          );
        });
        if (!sameSong) {
          problems.push(`id ${e.id} is "${r.artistName} - ${r.trackName}", not "${e.artist} - ${e.title}"`);
        }
        if (!artistMatches(e.artist, r.artistName)) {
          warnings.push(`id ${e.id} billed as "${r.artistName}", stored as "${e.artist}"`);
        }
        if (matchAlbum(e.album, r.collectionName).quality === 0) {
          warnings.push(`id ${e.id} is on "${r.collectionName}", stored as "${e.album}" (${e.artist} - ${e.title})`);
        }
      }
      for (const id of batch) {
        if (!seen.has(id)) problems.push(`id ${id} not found in the store (${byId.get(id).artist} - ${byId.get(id).title})`);
      }
      await sleep(SLEEP_MS);
    }
  }

  if (!args.includes('--no-head')) {
    console.log(`HEAD-checking ${catalog.length} preview urls...`);
    const batchSize = 5;
    for (let i = 0; i < catalog.length; i += batchSize) {
      const batch = catalog.slice(i, i + batchSize);
      const statuses = await Promise.all(batch.map((s) => headOk(s.previewUrl)));
      statuses.forEach((st, j) => {
        if (st !== 200) problems.push(`preview HEAD ${st}: ${batch[j].artist} - ${batch[j].title} (${batch[j].previewUrl})`);
      });
      await sleep(1000);
      if ((i / batchSize) % 20 === 0) process.stdout.write(`  ${i + batch.length}/${catalog.length}\r`);
    }
    console.log('');
  }

  console.log(`\nchecked ${catalog.length} entries`);
  if (warnings.length) {
    console.log(`WARNINGS (${warnings.length}):`);
    for (const w of warnings) console.log(`  ? ${w}`);
  }
  if (problems.length) {
    console.log(`PROBLEMS (${problems.length}):`);
    for (const p of problems) console.log(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log('validation OK');
  }
}

// ---- entry point ----

// Only run when invoked directly, so importing a helper cannot kick off a
// resolve run.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

const [cmd = 'resolve', ...rest] = process.argv.slice(2);
const args = [cmd, ...rest];
const commands = {
  resolve: cmdResolve,
  precheck: cmdPrecheck,
  merge: cmdMerge,
  report: cmdReport,
  validate: cmdValidate,
};
const fn = commands[cmd] || commands[cmd.replace(/^--/, '')];
if (invokedDirectly) {
  if (!fn) {
    console.error(`unknown command "${cmd}". Use: resolve | precheck | merge | report | validate`);
    process.exit(1);
  }
  fn(args.slice(1)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
