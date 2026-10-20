import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, posix, sep } from 'node:path';
import sharp from 'sharp';
import { describeValue } from '../report.js';
import { PET_FRAME, PET_JSON_MAX_BYTES, PET_MAX_BYTES, PET_ROW_COUNT, PET_SHEET_HEIGHTS, PET_SHEET_WIDTH } from './pet-format.js';

export const PET_DIR = '_bake/pet';
export const DEFAULT_PET = 'crt-monitor';
export const BUILT_IN_PETS = {
  'crt-monitor': { author: 'wxy', license: 'CC BY 4.0' },
  miso: { author: 'gaerae (PlayPets)', license: 'MIT' },
};

const BUILT_IN_DIR = join(import.meta.dirname, 'pets');
const SHEET_FORMATS = ['png', 'webp'];
const DOWNLOAD_TIMEOUT = 30_000;
const LICENSE = 'LICENSE.txt';
const WEBP = { quality: 90, alphaQuality: 100 };

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

export async function readPet(root, pet, report) {
  let read;
  if (Object.hasOwn(BUILT_IN_PETS, pet)) read = await readFolder(join(BUILT_IN_DIR, pet), null, report);
  else if (isUrl(pet)) read = await downloadPet(pet, (message) => report(null, message));
  else read = await readFolder(join(root, pet), petFolder(pet), report);
  if (read === null) return null;
  const { name, sheet, image, reportSheet } = read;
  const published = image.format === 'webp' && image.height === PET_ROW_COUNT * PET_FRAME.height ? sheet : await croppedSheet(sheet);
  if (published.length > PET_MAX_BYTES) {
    reportSheet(`the spritesheet has ${megabytes(published.length)} as WebP, a published pet spritesheet must be at most ${byteLimit(PET_MAX_BYTES)}`);
    return null;
  }
  const credit = Object.hasOwn(BUILT_IN_PETS, pet) ? BUILT_IN_PETS[pet] : null;
  const files = [
    { path: `${PET_DIR}/pet.json`, source: `${JSON.stringify({ displayName: name, spritesheetPath: 'spritesheet.webp', ...(credit ? { credit: { ...credit, href: LICENSE } } : {}) })}\n` },
    { path: `${PET_DIR}/spritesheet.webp`, source: published },
    {
      path: `${PET_DIR}/frame.webp`,
      source: await sharp(sheet)
        .extract({ left: 0, top: 0, ...PET_FRAME })
        .webp(WEBP)
        .toBuffer(),
    },
    ...(credit ? [{ path: `${PET_DIR}/${LICENSE}`, source: readFileSync(join(BUILT_IN_DIR, pet, 'LICENSE')) }] : []),
  ];
  return { name, files };
}

async function readFolder(dir, folder, report) {
  const label = (name) => (folder === null ? name : posix.join(folder, name));
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    report(null, `the folder ${folder} does not exist`);
    return null;
  }
  if (!existsSync(join(dir, 'pet.json'))) {
    report(null, `${label('pet.json')} does not exist`);
    return null;
  }
  const jsonPath = fileInside(dir, 'pet.json');
  if (jsonPath === null) {
    report(label('pet.json'), 'pet.json must be a file inside the pet folder');
    return null;
  }
  if (statSync(jsonPath).size > PET_JSON_MAX_BYTES) {
    report(label('pet.json'), `pet.json is larger than ${byteLimit(PET_JSON_MAX_BYTES)}`);
    return null;
  }
  const json = petJson(readFileSync(jsonPath, 'utf8'), (message) => report(label('pet.json'), message));
  if (json === null) return null;
  const sheetName = posix.normalize(json.spritesheetPath);
  const sheetPath = posix.isAbsolute(sheetName) ? null : fileInside(dir, sheetName);
  if (sheetPath === null) {
    report(label('pet.json'), `spritesheetPath ${JSON.stringify(json.spritesheetPath)} does not name a file in the pet folder`);
    return null;
  }
  const reportSheet = (message) => report(label(sheetName), message);
  const size = statSync(sheetPath).size;
  if (size > PET_MAX_BYTES) {
    reportSheet(`the spritesheet has ${megabytes(size)}, a pet spritesheet must be at most ${byteLimit(PET_MAX_BYTES)}`);
    return null;
  }
  const sheet = readFileSync(sheetPath);
  const image = await sheetImage(sheet, reportSheet);
  return image === null ? null : { name: json.displayName, sheet, image, reportSheet };
}

function fileInside(dir, name) {
  const path = join(dir, name);
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) return null;
  const folder = realpathSync(dir);
  return realpathSync(path).startsWith(folder + sep) ? path : null;
}

async function downloadPet(url, report) {
  const text = await download(url, PET_JSON_MAX_BYTES, report);
  if (text === null) return null;
  const json = petJson(text.toString('utf8'), (message) => report(`${url}: ${message}`));
  if (json === null) return null;
  const sheetUrl = new URL(json.spritesheetPath, url);
  if (!isUrl(sheetUrl.href)) {
    report(`${url}: spritesheetPath ${JSON.stringify(json.spritesheetPath)} is not an http or https address`);
    return null;
  }
  const sheet = await download(sheetUrl.href, PET_MAX_BYTES, report);
  if (sheet === null) return null;
  const reportSheet = (message) => report(`${sheetUrl.href}: ${message}`);
  const image = await sheetImage(sheet, reportSheet);
  return image === null ? null : { name: json.displayName, sheet, image, reportSheet };
}

async function download(url, limit, report) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT), redirect: 'follow' });
  } catch (error) {
    report(`cannot download ${url}: ${error.cause?.message ?? error.message}`);
    return null;
  }
  if (!response.ok) {
    report(`cannot download ${url}: the server answered ${response.status}`);
    return null;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) {
      await response.body.cancel().catch(() => {});
      report(`${url} is larger than ${byteLimit(limit)}`);
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function petJson(text, report) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    report(`pet.json is not valid JSON: ${error.message}`);
    return null;
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    report('pet.json must hold an object');
    return null;
  }
  if (typeof json.displayName !== 'string' || json.displayName.trim() === '') {
    report('pet.json must have a non-empty displayName');
    return null;
  }
  if (typeof json.spritesheetPath !== 'string' || json.spritesheetPath.trim() === '') {
    report('pet.json must have a non-empty spritesheetPath');
    return null;
  }
  return { displayName: json.displayName.trim(), spritesheetPath: json.spritesheetPath };
}

async function sheetImage(sheet, report) {
  let metadata;
  try {
    metadata = await sharp(sheet).metadata();
  } catch {
    report('the spritesheet is not a PNG or WebP image');
    return null;
  }
  if (!SHEET_FORMATS.includes(metadata.format)) {
    report(`the spritesheet is ${metadata.format.toUpperCase()}, a pet spritesheet must be PNG or WebP`);
    return null;
  }
  const { width, height } = metadata;
  if (width !== PET_SHEET_WIDTH || !PET_SHEET_HEIGHTS.includes(height)) {
    report(`the spritesheet is ${width}x${height} pixels, a pet spritesheet must be ${PET_SHEET_HEIGHTS.map((sheetHeight) => `${PET_SHEET_WIDTH}x${sheetHeight}`).join(' or ')}`);
    return null;
  }
  return { format: metadata.format, width, height };
}

function croppedSheet(sheet) {
  return sharp(sheet)
    .extract({ left: 0, top: 0, width: PET_SHEET_WIDTH, height: PET_ROW_COUNT * PET_FRAME.height })
    .webp(WEBP)
    .toBuffer();
}

function byteLimit(limit) {
  return limit >= 1024 * 1024 ? `${limit / 1024 / 1024} MB` : `${limit / 1024} KB`;
}

function megabytes(size) {
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function isUrl(value) {
  return URL.canParse(value) && ['http:', 'https:'].includes(new URL(value).protocol);
}

function petChoices() {
  return `${Object.keys(BUILT_IN_PETS)
    .map((name) => JSON.stringify(name))
    .join(', ')}, a folder in the blog or the http or https URL of a pet.json`;
}
