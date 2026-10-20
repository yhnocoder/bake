import { PET_FRAME, PET_JSON_MAX_BYTES, PET_MAX_BYTES, PET_SHEET_HEIGHTS, PET_SHEET_WIDTH } from './pet-format.js';

export const READER_PET_KEY = 'bk-chat-pet';

const REQUEST = { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' };

export class PetError extends Error {
  constructor(code, detail = '') {
    super(detail === '' ? code : `${code}: ${detail}`);
    this.code = code;
    this.detail = detail;
  }
}

export function storedReaderPet() {
  try {
    const stored = JSON.parse(localStorage.getItem(READER_PET_KEY));
    return typeof stored?.url === 'string' && typeof stored.name === 'string' && typeof stored.frame === 'string' && stored.frame.startsWith('data:image/') ? stored : null;
  } catch {
    return null;
  }
}

export async function chooseReaderPet(address) {
  const { url, name, blob } = await fetchPet(address);
  const bitmap = await sheetBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = PET_FRAME.width;
  canvas.height = PET_FRAME.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, PET_FRAME.width, PET_FRAME.height, 0, 0, PET_FRAME.width, PET_FRAME.height);
  bitmap.close();
  const pet = { url, name, frame: canvas.toDataURL('image/webp', 0.9) };
  localStorage.setItem(READER_PET_KEY, JSON.stringify(pet));
  return pet;
}

export function forgetReaderPet() {
  localStorage.removeItem(READER_PET_KEY);
}

export async function readerPetSheet(address) {
  const { blob } = await fetchPet(address);
  const bitmap = await sheetBitmap(blob);
  const rows = bitmap.height / PET_FRAME.height;
  bitmap.close();
  return { sheet: URL.createObjectURL(blob), rows };
}

async function fetchPet(address) {
  const url = webAddress(address);
  const text = new TextDecoder().decode(await download(url, PET_JSON_MAX_BYTES));
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new PetError('json');
  }
  if (typeof json?.displayName !== 'string' || json.displayName.trim() === '' || typeof json.spritesheetPath !== 'string') throw new PetError('json');
  const sheet = webAddress(new URL(json.spritesheetPath, url).href);
  const bytes = await download(sheet, PET_MAX_BYTES);
  return { url, name: json.displayName.trim(), blob: new Blob([bytes]) };
}

async function sheetBitmap(blob) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new PetError('image');
  }
  if (bitmap.width !== PET_SHEET_WIDTH || !PET_SHEET_HEIGHTS.includes(bitmap.height)) {
    const size = `${bitmap.width}x${bitmap.height}`;
    bitmap.close();
    throw new PetError('size', size);
  }
  return bitmap;
}

async function download(url, limit) {
  let response;
  try {
    response = await fetch(url, REQUEST);
  } catch (error) {
    throw new PetError('network', error.message);
  }
  if (!response.ok) throw new PetError('network', String(response.status));
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new PetError('large');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new PetError('large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function webAddress(address) {
  const url = URL.canParse(address) ? new URL(address) : null;
  if (url === null || !['http:', 'https:'].includes(url.protocol)) throw new PetError('address');
  return url.href;
}
