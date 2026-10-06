import { normalizeIdentifier } from 'micromark-util-normalize-identifier';

export function footnoteKey(label) {
  return normalizeIdentifier(label).toLowerCase();
}
