import { normalizeIdentifier } from 'micromark-util-normalize-identifier';

export function footnoteKey(label) {
  return normalizeIdentifier(label).toLowerCase();
}

export function nextFootnoteLabel(used) {
  for (let number = 1; ; number++) {
    const label = `n${number}`;
    if (!used.has(footnoteKey(label))) return label;
  }
}
