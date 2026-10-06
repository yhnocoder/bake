import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import sharp from 'sharp';

const maxWidth = 1600;
const convertedToWebp = ['.png', '.jpg', '.jpeg'];
const resizable = ['.png', '.jpg', '.jpeg', '.webp', '.avif'];

export function isLocalImage(src) {
  return !src.startsWith('/') && !/^[a-z][a-z\d+.-]*:/i.test(src);
}

export async function processImage(file) {
  const input = await readFile(file);
  const hash = createHash('sha256').update(input).digest('hex').slice(0, 4);
  const extension = extname(file).toLowerCase();
  const metadata = await sharp(input).metadata();
  const { width, height } = metadata.autoOrient;
  const resize = resizable.includes(extension) && width > maxWidth;
  if (!convertedToWebp.includes(extension) && !resize) {
    return { data: input, hash, extension, width, height: metadata.pageHeight ?? height };
  }
  let image = sharp(input).autoOrient();
  if (resize) image = image.resize({ width: maxWidth });
  if (convertedToWebp.includes(extension)) image = image.webp();
  const { data, info } = await image.toBuffer({ resolveWithObject: true });
  return { data, hash, extension: convertedToWebp.includes(extension) ? '.webp' : extension, width: info.width, height: info.height };
}
