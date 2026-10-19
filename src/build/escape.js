import { stringifyEntities } from 'stringify-entities';

export function escapeMarkup(text) {
  return stringifyEntities(String(text), { escapeOnly: true, useNamedReferences: true });
}
