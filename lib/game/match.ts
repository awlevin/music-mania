// Forgiving answer matching. People type on phones, in a hurry, at a party:
// typos, missing apostrophes, a dropped "The", and "feat." credits must not
// cost them the round.

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalize(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function dropLeadingArticle(s: string): string {
  return s.replace(/^(the|a|an) /, '');
}

/** "Song (feat. X) - Remastered 2011" → "Song". */
function stripDecorations(raw: string): string {
  return raw
    .replace(/\s+-\s+.*$/, '')
    .replace(/\s*[([][^)\]]*[)\]]/g, ' ')
    .replace(/\s+(feat\.?|ft\.?|featuring)\s+.*$/i, '');
}

/** Every form of `raw` a player could reasonably type. */
function variants(raw: string): string[] {
  const out = new Set<string>();
  const add = (s: string) => {
    const n = normalize(s);
    if (!n) return;
    out.add(n);
    out.add(dropLeadingArticle(n));
  };
  add(raw);
  add(stripDecorations(raw));
  // "(I Can't Get No) Satisfaction": keep the bracketed words, lose the brackets.
  add(raw.replace(/[()[\]]/g, ' '));
  return [...out].filter(Boolean);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = row;
  }
  return prev[b.length];
}

/** Typos allowed for a target of this length. Short words must be exact. */
function tolerance(length: number): number {
  if (length <= 4) return 0;
  if (length <= 8) return 1;
  if (length <= 14) return 2;
  return 3;
}

function close(guess: string, target: string): boolean {
  if (guess === target) return true;
  // A long target with a wildly different length is never a typo.
  if (Math.abs(guess.length - target.length) > tolerance(target.length)) return false;
  return levenshtein(guess, target) <= tolerance(target.length);
}

function matchesAny(guess: string, targets: string[]): boolean {
  const guesses = variants(guess);
  return guesses.some((g) => targets.some((t) => close(g, t)));
}

export function matchesText(guess: string, answer: string): boolean {
  return matchesAny(guess, variants(answer));
}

/**
 * "Queen & David Bowie" and "Queen" are the same act: the one whose name
 * comes first. Used wherever two songs count as "by the same artist".
 */
export function leadArtist(artist: string): string {
  return artist
    .split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b)\s*/i)[0]
    .trim()
    .toLowerCase();
}

/**
 * Artists also match on any one credited name: "Queen" is right for
 * "Queen & David Bowie", and so is "David Bowie".
 */
export function matchesArtist(guess: string, artist: string): boolean {
  const parts = artist
    .split(/\s*(?:,|&|\band\b|\bx\b|\bwith\b|\bfeat\.?|\bft\.?|\bfeaturing\b)\s*/i)
    .filter((p) => normalize(p).length >= 3);
  const targets = [...variants(artist), ...parts.flatMap(variants)];
  return matchesAny(guess, targets);
}

/** A four-digit year, or null. */
export function parseYear(guess: string): number | null {
  const m = guess.trim().match(/^(\d{4})$/);
  return m ? Number(m[1]) : null;
}
