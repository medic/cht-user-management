// Order-independent, token-aware name matching for eCHIS place lookup.
//
// Names arrive as free text — "First Middle Last", in any order, with any
// number of parts — and must be matched against an eCHIS place name that may
// drop or add a middle name, reorder the parts, or carry minor spelling drift.
//
// Scores run 0..1 where LOWER is better and 0 means identical.
// `MATCH_THRESHOLD` is the single cutoff that turns a score into a verdict
const MATCH_THRESHOLD = 0.25;

export function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

export function tokenize(value: string): string[] {
  return [...new Set(normalize(value).split(/[\s-]+/).filter(Boolean))];
}

// Normalized similarity of two tokens in [0,1]; 1 = identical.
function tokenSimilarity(a: string, b: string): number {
  if (a === b) {
    return 1;
  }
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest;
}

function levenshtein(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (!a.length) {
    return b.length;
  }
  if (!b.length) {
    return a.length;
  }

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

// Mean, over each `from` token, of its best similarity against any `to` token.
function coverage(from: string[], to: string[]): number {
  return from.reduce((sum, token) => sum + Math.max(...to.map(other => tokenSimilarity(token, other))), 0) / from.length;
}

/**
 * Order-independent name distance in [0,1]; 0 = identical token sets.
 *
 * Combines coverage in both directions (query→place and place→query) with their
 * harmonic mean (F1), so a part present on only one side is tolerated but a name
 * that merely shares a single common token is not enough.
 */
export function nameMatchScore(query: string, place: string): number {
  const queryTokens = tokenize(query);
  const placeTokens = tokenize(place);
  if (!queryTokens.length || !placeTokens.length) {
    return 1;
  }

  const forward = coverage(queryTokens, placeTokens);
  const backward = coverage(placeTokens, queryTokens);
  const f1 = forward + backward === 0 ? 0 : (2 * forward * backward) / (forward + backward);
  return 1 - f1;
}

export function isNameMatch(query: string, place: string): boolean {
  return nameMatchScore(query, place) <= MATCH_THRESHOLD;
}

export interface RankedNameMatch<T> {
  item: T;
  score: number;
}

/**
 * Ranks `items` by how well their name matches `query`: keeps only those that
 * clear the match verdict and orders them best-first (lowest score). The cutoff
 * lives here — callers receive matches, not raw scores to threshold themselves.
 */
export function rankNameMatches<T>(
  query: string,
  items: T[],
  nameOf: (item: T) => string,
): RankedNameMatch<T>[] {
  return items
    .map(item => ({ item, score: nameMatchScore(query, nameOf(item)) }))
    .filter(({ score }) => score <= MATCH_THRESHOLD)
    .sort((a, b) => a.score - b.score);
}
