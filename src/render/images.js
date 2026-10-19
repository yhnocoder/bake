import { posix } from 'node:path';
import sharp from 'sharp';

export const PAGE_WIDTH = 1340;
const PIXEL_DENSITY = 2;
const CONVERTED = ['png', 'jpeg', 'gif', 'webp'];
const LOSSLESS = ['png', 'gif'];
const KEPT = ['svg', 'avif'];

export const IMAGE_FORMATS = 'PNG, JPEG, GIF, WebP, AVIF or SVG';

export async function readImage(path) {
  try {
    const { format, width, height, pageHeight } = await sharp(path, { animated: true }).metadata();
    if (!CONVERTED.includes(format) && !KEPT.includes(format)) return null;
    return { format, width, height: pageHeight ?? height };
  } catch {
    return null;
  }
}

export function publishedImage(source, image, displayWidths) {
  if (KEPT.includes(image.format)) return { path: source, width: image.width, height: image.height, convert: null };
  const limit = Math.max(...displayWidths.map((width) => (width ?? PAGE_WIDTH) * PIXEL_DENSITY));
  const width = Math.min(image.width, Math.round(limit));
  const height = Math.round((image.height * width) / image.width);
  const path = posix.join(posix.dirname(source), `${posix.basename(source, posix.extname(source))}.webp`);
  return { path, width, height, convert: { width, lossless: LOSSLESS.includes(image.format) } };
}

export function convertImage(file, { width, lossless }) {
  return sharp(file, { animated: true }).resize({ width, withoutEnlargement: true }).webp(lossless ? { lossless: true } : {}).toBuffer();
}
