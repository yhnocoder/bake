import { closest, distance } from 'fastest-levenshtein';

// A name that a third of the length of the shorter of the two names in edits turns into the written one is taken to be what the writer meant.
export function meantName(written, names) {
  const candidates = [...names];
  if (candidates.length === 0) return undefined;
  const lower = written.toLowerCase();
  const near = closest(lower, candidates);
  return distance(lower, near) <= Math.ceil(Math.min(lower.length, near.length) / 3) ? near : undefined;
}
