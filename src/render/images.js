import { posix } from 'node:path';
import sharp from 'sharp';

export const PAGE_WIDTH = 1340;
const PIXEL_DENSITY = 2;
const CONVERTED = ['png', 'jpeg', 'gif', 'webp'];
const LOSSLESS = ['png', 'gif'];
const KEPT = ['svg', 'avif'];
const UNSUPPORTED = /unsupported image format/;

export const IMAGE_FORMATS = 'PNG, JPEG, GIF, WebP, AVIF or SVG';

export async function readImage(path) {
  let metadata;
  try {
    metadata = await sharp(path, { animated: true }).metadata();
  } catch (error) {
    if (UNSUPPORTED.test(error.message)) return { format: null };
    return { error: error.message.replace(/[:\s]+$/, '') };
  }
  const { format, width, height, pageHeight } = metadata;
  if (!CONVERTED.includes(format) && !KEPT.includes(format)) return { format: null };
  return { format, width, height: pageHeight ?? height };
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
