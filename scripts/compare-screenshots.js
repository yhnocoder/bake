import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const margin = 80;
const maxCropHeight = 1800;
const padColor = [128, 128, 128, 255];

const [baseDir, headDir, outDir, urlPrefix = '', urlSuffix = ''] = process.argv.slice(2);
if (baseDir === undefined || headDir === undefined || outDir === undefined) {
  console.error('Usage: node scripts/compare-screenshots.js <base dir> <head dir> <output dir> [image URL prefix] [image URL suffix]');
  process.exit(2);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'pages'), { recursive: true });
mkdirSync(join(outDir, 'crops'), { recursive: true });

const hasBase = existsSync(baseDir);
const baseShots = screenshots(baseDir);
const headShots = screenshots(headDir);
const results = [...new Set([...baseShots, ...headShots])].sort().map((file) => {
  const name = file.replace(/\.png$/, '');
  const shot = { file, page: name.slice(0, name.lastIndexOf('.')), variant: name.slice(name.lastIndexOf('.') + 1) };
  if (headShots.includes(file)) copyFileSync(join(headDir, file), join(outDir, 'pages', file));
  if (!baseShots.includes(file)) return { ...shot, status: 'new', ...cropOne(join(headDir, file), file, 'after') };
  if (!headShots.includes(file)) return { ...shot, status: 'removed', ...cropOne(join(baseDir, file), file, 'before') };
  return { ...shot, ...compare(file) };
});

writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(results, null, 2)}\n`);
writeFileSync(join(outDir, 'summary.md'), summary(results));
console.log(countLine(results));

function screenshots(dir) {
  return existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith('.png')) : [];
}

function compare(file) {
  const before = readPng(join(baseDir, file));
  const after = readPng(join(headDir, file));
  const width = Math.max(before.width, after.width);
  const height = Math.max(before.height, after.height);
  const paddedBefore = pad(before, width, height);
  const paddedAfter = pad(after, width, height);
  const diff = new PNG({ width, height });
  const pixels = pixelmatch(paddedBefore.data, paddedAfter.data, diff.data, width, height, { threshold: 0.1 });
  if (pixels === 0) return { status: 'unchanged' };
  const rows = changedRows(diff);
  const top = Math.max(0, rows.first - margin);
  const bottom = Math.min(height, rows.last + 1 + margin, top + maxCropHeight);
  for (const [suffix, png] of [['before', paddedBefore], ['after', paddedAfter], ['diff', diff]]) {
    writePng(join(outDir, 'crops', cropName(file, suffix)), crop(png, top, bottom));
  }
  return {
    status: 'changed',
    ratio: pixels / (width * height),
    top,
    bottom,
    height,
    continues: rows.last + 1 + margin > bottom && bottom < height,
  };
}

function cropOne(path, file, suffix) {
  const png = readPng(path);
  const bottom = Math.min(png.height, maxCropHeight);
  writePng(join(outDir, 'crops', cropName(file, suffix)), crop(png, 0, bottom));
  return { top: 0, bottom, height: png.height, continues: bottom < png.height };
}

function changedRows(diff) {
  let first = -1;
  let last = -1;
  for (let y = 0; y < diff.height; y += 1) {
    for (let x = 0; x < diff.width; x += 1) {
      const i = (y * diff.width + x) * 4;
      if (diff.data[i] === 255 && diff.data[i + 1] === 0 && diff.data[i + 2] === 0) {
        if (first === -1) first = y;
        last = y;
        break;
      }
    }
  }
  return { first, last };
}

function pad(png, width, height) {
  if (png.width === width && png.height === height) return png;
  const padded = new PNG({ width, height });
  for (let i = 0; i < padded.data.length; i += 4) padded.data.set(padColor, i);
  PNG.bitblt(png, padded, 0, 0, png.width, png.height, 0, 0);
  return padded;
}

function crop(png, top, bottom) {
  const cropped = new PNG({ width: png.width, height: bottom - top });
  PNG.bitblt(png, cropped, 0, top, png.width, bottom - top, 0, 0);
  return cropped;
}

function readPng(path) {
  return PNG.sync.read(readFileSync(path));
}

function writePng(path, png) {
  writeFileSync(path, PNG.sync.write(png));
}

function cropName(file, suffix) {
  return file.replace(/\.png$/, `.${suffix}.png`);
}

function url(path) {
  return `${urlPrefix}${path}${urlSuffix}`;
}

function image(path, alt) {
  return `![${alt}](${url(path)})`;
}

function countLine(results) {
  const pages = new Set(results.map((result) => result.page)).size;
  const counts = ['changed', 'new', 'removed', 'unchanged']
    .map((status) => [status, results.filter((result) => result.status === status).length])
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${count} ${status}`);
  return `${results.length} screenshots of ${pages} pages: ${counts.join(', ') || 'none'}`;
}

function summary(results) {
  const lines = [`**${countLine(results)}.**`, ''];
  if (!hasBase) lines.push('There are no base screenshots, so every screenshot is reported as new.', '');
  const shown = results.filter((result) => result.status !== 'unchanged');
  if (shown.length === 0 && results.length > 0) lines.push('No page looks different from the base.', '');
  for (const page of [...new Set(shown.map((result) => result.page))]) {
    lines.push(`#### ${page}`, '', '| Variant | Before | After | Diff |', '| --- | --- | --- | --- |');
    for (const result of shown.filter((item) => item.page === page)) lines.push(row(result));
    lines.push('');
  }
  if (results.some((result) => result.status !== 'removed')) {
    lines.push('<details><summary>Full-page screenshots of every page</summary>', '');
    for (const page of [...new Set(results.map((result) => result.page))]) {
      const links = results
        .filter((result) => result.page === page && result.status !== 'removed')
        .map((result) => `[${result.variant}](${url(`pages/${result.file}`)})`);
      if (links.length > 0) lines.push(`- ${page}: ${links.join(' · ')}`);
    }
    lines.push('', '</details>', '');
  }
  return `${lines.join('\n')}\n`;
}

function row(result) {
  const before = result.status === 'new' ? 'New page' : image(`crops/${cropName(result.file, 'before')}`, 'before');
  const after = result.status === 'removed' ? 'Removed' : image(`crops/${cropName(result.file, 'after')}`, 'after');
  const diff = result.status === 'changed' ? image(`crops/${cropName(result.file, 'diff')}`, 'diff') : '';
  return `| ${describe(result)} | ${before} | ${after} | ${diff} |`;
}

function describe(result) {
  const parts = [`**${result.variant}**`];
  if (result.status === 'changed') parts.push(`${formatPercent(result.ratio)} of pixels differ`);
  parts.push(`rows ${result.top} to ${result.bottom} of ${result.height}`);
  if (result.continues) parts.push(result.status === 'changed' ? 'the difference continues below' : 'the page continues below');
  return parts.join('<br>');
}

function formatPercent(ratio) {
  const percent = ratio * 100;
  return percent < 0.1 ? 'under 0.1%' : `${percent.toFixed(1)}%`;
}
