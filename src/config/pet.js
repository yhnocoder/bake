import { posix } from 'node:path';
import { describeValue } from '../report.js';

export const DEFAULT_PET = 'crt-monitor';
export const BUILT_IN_PETS = {
  'crt-monitor': { author: 'wxy', license: 'CC BY 4.0' },
  miso: { author: 'gaerae (PlayPets)', license: 'MIT' },
};

export function petFolder(pet) {
  return Object.hasOwn(BUILT_IN_PETS, pet) || isUrl(pet) ? null : posix.normalize(pet).replace(/\/$/, '');
}

export function petSourceProblem(pet) {
  if (typeof pet !== 'string' || pet.trim() === '') return `chat.pet must be ${petChoices()}, got ${describeValue(pet)}`;
  if (Object.hasOwn(BUILT_IN_PETS, pet)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(pet)) return isUrl(pet) ? null : `chat.pet must be an http or https URL of a pet.json, got ${JSON.stringify(pet)}`;
  const folder = posix.normalize(pet);
  if (posix.isAbsolute(folder) || folder === '..' || folder.startsWith('../')) return `chat.pet must be a folder inside the blog, got ${JSON.stringify(pet)}`;
  return null;
}

export function isUrl(value) {
  return URL.canParse(value) && ['http:', 'https:'].includes(new URL(value).protocol);
}

function petChoices() {
  return `${Object.keys(BUILT_IN_PETS)
    .map((name) => JSON.stringify(name))
    .join(', ')}, a folder in the blog or the http or https URL of a pet.json`;
}
