#!/usr/bin/env node
// Reproducible catalog builder for the music-mania "name that tune" game.
// Plain ESM, no dependencies, requires Node 22+ (global fetch).
//
// Usage:
//   node build-catalog.mjs                 # resolve all seed entries (cached)
//   node build-catalog.mjs --only=12,45     # resolve only these seed indices (0-based)
//   node build-catalog.mjs --force          # ignore cache and re-fetch everything
//
// Reads:  catalog-seed.json (array of {artist, title, album, year})
// Writes: cache/*.json (one cached iTunes response per query)
//         resolved.json (array of final catalog objects, keyed by seed index)
//         misses.json   (seed entries that could not be confidently resolved)
//         catalog.json  (only written when ALL 200 seeds resolve; final output)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(__dirname, 'catalog-seed.json');
const CACHE_DIR = path.join(__dirname, 'cache');
const RESOLVED_PATH = path.join(__dirname, 'resolved.json');
const MISSES_PATH = path.join(__dirname, 'misses.json');
const CATALOG_PATH = path.join(__dirname, 'catalog.json');

const SLEEP_MS = 3600; // ~16-17 req/min, under the ~20/min limit
const BACKOFF_MS = 60_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cacheKeyFor(query) {
  const hash = createHash('sha1').update(query).digest('hex').slice(0, 16);
  const safe = query.replace(/[^a-z0-9]+/gi, '_').slice(0, 60);
  return `${safe}_${hash}.json`;
}

async function fetchWithCache(query, { force = false } = {}) {
  await mkdir(CACHE_DIR, { recursive: true });
  const cacheFile = path.join(CACHE_DIR, cacheKeyFor(query));

  if (!force) {
    try {
      const cached = await readFile(cacheFile, 'utf8');
      return JSON.parse(cached);
    } catch {
      // not cached yet, fall through to fetch
    }
  }

  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
    query,
  )}&entity=song&country=US&limit=25`;

  let attempt = 0;
  while (true) {
    attempt += 1;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'music-mania-catalog-builder/1.0' },
    });
    if (res.status === 403 || res.status === 429) {
      console.warn(
        `  [rate-limited] status=${res.status} query="${query}" — backing off ${BACKOFF_MS}ms (attempt ${attempt})`,
      );
      await sleep(BACKOFF_MS);
      if (attempt >= 5) {
        throw new Error(`Giving up on query "${query}" after ${attempt} attempts`);
      }
      continue;
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for query "${query}"`);
    }
    const json = await res.json();
    await writeFile(cacheFile, JSON.stringify(json, null, 2));
    return json;
  }
}

// ---- normalization / matching helpers ----

const EDITION_RE =
  /\s*[\(\[][^)\]]*\b(deluxe|remaster(ed)?|edition|version|anniversary|bonus track|expanded|special edition|re-?issue|2011|2012|2013|2014|2015)\b[^)\]]*[\)\]]/gi;

// Regex-based edition stripping can leave a stray unmatched bracket behind
// when the source has nested parens, e.g. "8 Mile (Music From And Inspired
// By The Motion Picture (Expanded Edition))" -> "8 Mile)". Drop any
// bracket character that has no matching partner rather than ship that.
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
      } // else: stray closing bracket, drop it
    } else {
      out += ch;
    }
  }
  return out;
}

function stripEditionSuffix(name) {
  if (!name) return name;
  let out = name.replace(EDITION_RE, '');
  out = out.replace(/\s*-\s*(single version|remastered.*|bonus track.*)$/i, '');
  // Non-bracketed trailing edition markers, e.g. "Ready To Die the Remaster"
  out = out.replace(/\s+the\s+remaster(ed)?$/i, '');
  out = out.replace(/\s+remaster(ed)?$/i, '');
  out = dropUnbalancedBrackets(out);
  return out.trim();
}

// Known stylized-name symbol substitutions (e.g. Ed Sheeran's "÷" == "Divide").
const SYMBOL_WORDS = [
  [/÷/g, ' divide '],
  [/×/g, ' multiply '],
  [/\+/g, ' plus '],
  [/=/g, ' equals '],
];

function normalize(str) {
  let s = (str || '').toLowerCase();
  for (const [re, word] of SYMBOL_WORDS) s = s.replace(re, word);
  // Stylized "!" standing in for "i" between letters, e.g. "P!nk" -> "Pink"
  s = s.replace(/([a-z])!([a-z])/gi, '$1i$2');
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^the\s+/, '')
    .trim()
    .replace(/\s+/g, ' ');
}

// Tight comparison ignoring all whitespace/punctuation differences,
// e.g. "Run-D.M.C." and "Run-DMC" both -> "rundmc".
function normalizeTight(str) {
  return normalize(str).replace(/\s+/g, '');
}

function artistMatches(expected, candidate) {
  const e = normalize(expected);
  const c = normalize(candidate);
  if (!e || !c) return false;
  if (e === c) return true;
  if (normalizeTight(expected) === normalizeTight(candidate)) return true;
  // allow "Mark Ronson" to match "Mark Ronson Featuring Bruno Mars" etc.
  if (c.startsWith(e) || e.startsWith(c)) return true;
  if (c.includes(e)) return true;
  return false;
}

const BANNED_TITLE_WORDS =
  /\b(live|remix|karaoke|tribute|cover|re-?record(ed)?|instrumental|a cappella|acapella)\b/i;

function isDisallowedTrack(trackName) {
  return BANNED_TITLE_WORDS.test(trackName || '');
}

// Compilation-flagged album names are never acceptable, even if they
// happen to prefix/contain the expected album name.
const COMPILATION_RE =
  /\b(greatest hits|the hits|anthology|essential|now that's|ultimate|best of)\b/i;

function isCompilationAlbum(albumName) {
  return COMPILATION_RE.test(albumName || '');
}

// Returns { quality, cleanAlbum } where quality is 0 (no match), 1 (matched
// via an edition/subtitle strip or a subtitle-prefix fallback — use OUR
// curated clean seed album name, since the API name has extra cruft), or
// 2 (exact match / clean once the edition suffix is stripped — trust the
// API's own casing/accents for the stored album name).
function matchAlbum(expectedAlbum, candidateAlbum) {
  if (isCompilationAlbum(candidateAlbum)) return { quality: 0 };
  const expNorm = normalize(expectedAlbum);
  const candNorm = normalize(candidateAlbum);
  const stripped = stripEditionSuffix(candidateAlbum);
  const candStrippedNorm = normalize(stripped);
  if (expNorm === candNorm) return { quality: 2, cleanAlbum: candidateAlbum };
  if (expNorm === candStrippedNorm) return { quality: 2, cleanAlbum: stripped };
  // Subtitle/prefix match, e.g. "Saturday Night Fever" vs
  // "Saturday Night Fever (The Original Movie Soundtrack)", or
  // "The E.N.D." vs "THE E.N.D. (THE ENERGY NEVER DIES)".
  if (expNorm && candStrippedNorm.startsWith(`${expNorm} `)) {
    return { quality: 1, cleanAlbum: expectedAlbum };
  }
  if (expNorm && expNorm.startsWith(`${candStrippedNorm} `)) {
    return { quality: 1, cleanAlbum: expectedAlbum };
  }
  return { quality: 0 };
}

function pickBestCandidate(seed, results) {
  const candidates = results.filter(
    (r) =>
      r.kind === 'song' &&
      r.previewUrl &&
      r.trackId &&
      !isDisallowedTrack(r.trackName) &&
      artistMatches(seed.artist, r.artistName),
  );

  let best = null;
  let bestCleanAlbum = null;
  let bestScore = -1;
  for (const c of candidates) {
    const { quality, cleanAlbum } = matchAlbum(seed.album, c.collectionName);
    if (quality === 0) continue;
    // Prefer exact album match, then shorter/no-suffix track names (avoid "(Remastered)" versions)
    const titleBonus = /\(|remaster|deluxe|version/i.test(c.trackName) ? 0 : 0.5;
    const score = quality + titleBonus;
    if (score > bestScore) {
      bestScore = score;
      best = c;
      bestCleanAlbum = cleanAlbum;
    }
  }
  return best ? { track: best, cleanAlbum: bestCleanAlbum } : null;
}

// ---- main ----

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const onlyIndices = onlyArg
    ? new Set(onlyArg.slice('--only='.length).split(',').map(Number))
    : null;

  const seeds = JSON.parse(await readFile(SEED_PATH, 'utf8'));

  let resolved = {};
  try {
    resolved = JSON.parse(await readFile(RESOLVED_PATH, 'utf8'));
  } catch {
    resolved = {};
  }

  const misses = [];

  for (let i = 0; i < seeds.length; i++) {
    if (onlyIndices && !onlyIndices.has(i)) continue;
    const seed = seeds[i];
    if (!force && resolved[i]) {
      continue; // already resolved from a previous run
    }

    const query = `${seed.artist} ${seed.title}`;
    console.log(`[${i + 1}/${seeds.length}] ${seed.artist} - ${seed.title}`);

    let json;
    try {
      json = await fetchWithCache(query, { force });
    } catch (err) {
      console.error(`  ERROR fetching: ${err.message}`);
      misses.push({ index: i, seed, reason: `fetch error: ${err.message}` });
      await sleep(SLEEP_MS);
      continue;
    }

    const results = json.results || [];
    const picked = pickBestCandidate(seed, results);

    if (!picked) {
      const topCandidates = results
        .filter((r) => r.kind === 'song')
        .slice(0, 5)
        .map((r) => ({
          trackId: r.trackId,
          artistName: r.artistName,
          trackName: r.trackName,
          collectionName: r.collectionName,
          hasPreview: !!r.previewUrl,
        }));
      console.warn(`  MISS: no matching album/artist candidate with preview`);
      misses.push({ index: i, seed, reason: 'no match', topCandidates });
    } else {
      const { track: best, cleanAlbum } = picked;
      resolved[i] = {
        id: best.trackId,
        title: seed.title,
        artist: seed.artist,
        album: cleanAlbum,
        year: seed.year,
        genre: best.primaryGenreName,
        artworkUrl: (best.artworkUrl100 || '').replace('100x100bb', '600x600bb'),
        previewUrl: best.previewUrl,
      };
      console.log(`  OK -> album="${cleanAlbum}" id=${best.trackId}`);
      // Persist incrementally so a crash/interrupt doesn't lose progress.
      await writeFile(RESOLVED_PATH, JSON.stringify(resolved, null, 2));
    }

    // Only sleep when we actually hit the network (cache hits are free).
    await sleep(SLEEP_MS);
  }

  await writeFile(RESOLVED_PATH, JSON.stringify(resolved, null, 2));

  // Recompute full miss list across ALL seeds (not just the ones processed this run)
  const allMisses = [];
  for (let i = 0; i < seeds.length; i++) {
    if (!resolved[i]) {
      const existing = misses.find((m) => m.index === i);
      allMisses.push(existing || { index: i, seed: seeds[i], reason: 'not yet processed' });
    }
  }
  await writeFile(MISSES_PATH, JSON.stringify(allMisses, null, 2));

  console.log(`\nResolved: ${Object.keys(resolved).length}/${seeds.length}`);
  console.log(`Misses: ${allMisses.length}`);

  if (allMisses.length === 0) {
    const catalog = seeds.map((_, i) => resolved[i]);
    await writeFile(CATALOG_PATH, JSON.stringify(catalog, null, 2));
    console.log(`\nWrote ${CATALOG_PATH}`);
  } else {
    console.log('\nUnresolved seed indices:', allMisses.map((m) => m.index).join(', '));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
