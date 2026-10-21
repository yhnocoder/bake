import { PET_FRAME, PET_JSON_MAX_BYTES, PET_MAX_BYTES, PET_SHEET_HEIGHTS, PET_SHEET_WIDTH } from './pet-format.js';

const READER_PET_KEY = 'bk-chat-pet';

const REQUEST = { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' };
const TIMEOUT = 30_000;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let chosen = null;

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
  const fetched = await fetchPet(address);
  const { url, name, sheet } = fetched;
  let bitmap;
  try {
    bitmap = await createImageBitmap(sheet.blob);
  } catch {
    throw new PetError('image');
  }
  const canvas = document.createElement('canvas');
  canvas.width = PET_FRAME.width;
  canvas.height = PET_FRAME.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, PET_FRAME.width, PET_FRAME.height, 0, 0, PET_FRAME.width, PET_FRAME.height);
  bitmap.close();
  const pet = { url, name, frame: canvas.toDataURL('image/webp', 0.9) };
  try {
    localStorage.setItem(READER_PET_KEY, JSON.stringify(pet));
  } catch {
    throw new PetError('storage');
  }
  chosen = fetched;
  return pet;
}

export function forgetReaderPet() {
  chosen = null;
  try {
    localStorage.removeItem(READER_PET_KEY);
  } catch {}
}

export async function readerPetSheet(address) {
  const { sheet } = chosen?.url === address ? chosen : await fetchPet(address);
  return { sheet: URL.createObjectURL(sheet.blob), rows: sheet.rows };
}

async function fetchPet(address) {
  const url = webAddress(address);
  const pet = await download(url, PET_JSON_MAX_BYTES, 'jsonLarge');
  let json;
  try {
    json = JSON.parse(new TextDecoder().decode(pet.bytes));
  } catch {
    throw new PetError('json');
  }
  if (typeof json?.displayName !== 'string' || json.displayName.trim() === '' || typeof json.spritesheetPath !== 'string') throw new PetError('json');
  const sheetUrl = webAddress(new URL(json.spritesheetPath, pet.url).href);
  return { url, name: json.displayName.trim(), sheet: sheetFile((await download(sheetUrl, PET_MAX_BYTES, 'large')).bytes) };
}

export function sheetFile(bytes) {
  const header = imageHeader(bytes);
  if (header === null) throw new PetError('image');
  const { type, width, height } = header;
  if (width !== PET_SHEET_WIDTH || !PET_SHEET_HEIGHTS.includes(height)) throw new PetError('size', `${width}x${height}`);
  return { blob: new Blob([bytes], { type }), rows: height / PET_FRAME.height };
}

function imageHeader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset, length) => (bytes.length < offset + length ? '' : String.fromCharCode(...bytes.subarray(offset, offset + length)));
  if (bytes.length >= 24 && PNG_SIGNATURE.every((value, index) => bytes[index] === value) && ascii(12, 4) === 'IHDR') {
    return { type: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP' || bytes.length < 30) return null;
  const chunk = ascii(12, 4);
  if (chunk === 'VP8X') return { type: 'image/webp', width: 1 + (view.getUint32(24, true) & 0xffffff), height: 1 + (view.getUint32(26, true) >>> 8) };
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const bits = view.getUint32(21, true);
    return { type: 'image/webp', width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { type: 'image/webp', width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  return null;
}

async function download(url, limit, tooLarge) {
  const controller = new AbortController();
  // why: AbortSignal.timeout runs on a timer that page.clock in the browser tests cannot advance
  const timer = setTimeout(() => controller.abort(new DOMException('The download did not finish in time.', 'TimeoutError')), TIMEOUT);
  try {
    return await read(url, limit, tooLarge, controller.signal);
  } catch (error) {
    if (error instanceof PetError) throw error;
    throw error.name === 'TimeoutError' ? new PetError('timeout') : new PetError('network', error.message);
  } finally {
    clearTimeout(timer);
  }
}

async function read(url, limit, tooLarge, signal) {
  const response = await fetch(url, { ...REQUEST, signal });
  if (!response.ok) throw new PetError('network', String(response.status));
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new PetError(tooLarge);
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
      throw new PetError(tooLarge);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, url: response.url };
}

function webAddress(address) {
  const url = URL.canParse(address) ? new URL(address) : null;
  if (url === null || !['http:', 'https:'].includes(url.protocol)) throw new PetError('address');
  return url.href;
}
