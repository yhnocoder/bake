import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pixelmatch from 'pixelmatch';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { variants } from './screenshot-variants.js';

const margin = 80;
const minCropWidth = 640;
const maxCropHeight = 800;
const maxSideBySideWidth = 440;
const padColor = [128, 128, 128, 255];

const [baseDir, headDir, outDir, urlPrefix = '', urlSuffix = ''] = process.argv.slice(2);
if (baseDir === undefined || headDir === undefined || outDir === undefined) {
  console.error('Usage: node scripts/compare-screenshots.js <base dir> <head dir> <output dir> [image URL prefix] [image URL suffix]');
  process.exit(2);
}

rmSync(outDir, { recursive: true, force: true });
for (const dir of ['full', 'changes', 'pages']) mkdirSync(join(outDir, dir), { recursive: true });

const hasBase = existsSync(baseDir);
const baseShots = screenshots(baseDir);
const headShots = screenshots(headDir);
const browser = await chromium.launch();
const sheet = await browser.newPage();
try {
  const results = [];
  for (const file of sortShots([...new Set([...baseShots, ...headShots])])) {
    if (headShots.includes(file)) copyFileSync(join(headDir, file), join(outDir, 'full', file));
    results.push({ ...parseShot(file), ...(await compareShot(file)) });
  }
  const pages = [];
  for (const page of new Set(results.filter((result) => result.status !== 'removed').map((result) => result.page))) {
    pages.push({ page, sheets: await writeOverview(page) });
  }
  writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(results, null, 2)}\n`);
  writeFileSync(join(outDir, 'summary.md'), summary(results, pages));
  console.log(countLine(results));
} finally {
  await browser.close();
}

function screenshots(dir) {
  return existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith('.png')) : [];
}

function parseShot(file) {
  const name = file.replace(/\.png$/, '');
  const dot = name.lastIndexOf('.');
  return { file, page: name.slice(0, dot), variant: name.slice(dot + 1) };
}

function sortShots(files) {
  const order = (variant) => variants.findIndex((item) => item.name === variant);
  return files.sort((a, b) => {
    const shotA = parseShot(a);
    const shotB = parseShot(b);
    return shotA.page.localeCompare(shotB.page) || order(shotA.variant) - order(shotB.variant);
  });
}

async function compareShot(file) {
  if (!baseShots.includes(file)) return singleShot(join(headDir, file), file, 'new', 'New page');
  if (!headShots.includes(file)) return singleShot(join(baseDir, file), file, 'removed', 'Removed page');
  const before = readPng(join(baseDir, file));
  const after = readPng(join(headDir, file));
  const width = Math.max(before.width, after.width);
  const height = Math.max(before.height, after.height);
  const paddedBefore = pad(before, width, height);
  const paddedAfter = pad(after, width, height);
  const diff = new PNG({ width, height });
  const pixels = pixelmatch(paddedBefore.data, paddedAfter.data, diff.data, width, height, { threshold: 0.1 });
  if (pixels === 0) return { status: 'unchanged' };
  const area = cropArea(changedArea(diff), width, height);
  await writeSheet(join(outDir, 'changes', file), [
    { label: 'Before', png: crop(paddedBefore, area) },
    { label: 'After', png: crop(paddedAfter, area) },
    { label: 'Diff', png: crop(diff, area) },
  ], area.right - area.left <= maxSideBySideWidth ? 3 : 1);
  return { status: 'changed', ratio: pixels / (width * height), ...area, height };
}

async function singleShot(path, file, status, label) {
  const png = readPng(path);
  const area = { left: 0, top: 0, right: png.width, bottom: Math.min(png.height, maxCropHeight) };
  await writeSheet(join(outDir, 'changes', file), [{ label, png: crop(png, area) }], 1);
  return { status, ...area, height: png.height };
}

async function writeOverview(page) {
  const sheets = [];
  for (const device of [...new Set(variants.map((variant) => variant.device))]) {
    const shots = variants
      .filter((variant) => variant.device === device && headShots.includes(`${page}.${variant.name}.png`))
      .map((variant) => ({ variant, png: firstScreen(page, variant) }));
    if (shots.length === 0) continue;
    if (shots.every(({ png }) => png.width <= maxSideBySideWidth)) {
      const name = `${page}.${device}.png`;
      await writeSheet(join(outDir, 'pages', name), shots.map(panel), shots.length);
      sheets.push({ name, label: device, open: true });
    } else {
      for (const [index, shot] of shots.entries()) {
        const name = `${page}.${shot.variant.name}.png`;
        await writeSheet(join(outDir, 'pages', name), [panel(shot)], 1);
        sheets.push({ name, label: panel(shot).label, open: index === 0 });
      }
    }
  }
  return sheets;
}

function firstScreen(page, variant) {
  const png = readPng(join(headDir, `${page}.${variant.name}.png`));
  return crop(png, { left: 0, top: 0, right: png.width, bottom: Math.min(png.height, variant.height) });
}

function panel({ variant, png }) {
  return { label: `${variant.device}, ${variant.colorScheme}`, png };
}

function changedArea(diff) {
  const area = { left: diff.width, top: diff.height, right: -1, bottom: -1 };
  for (let y = 0; y < diff.height; y += 1) {
    for (let x = 0; x < diff.width; x += 1) {
      const i = (y * diff.width + x) * 4;
      if (diff.data[i] !== 255 || diff.data[i + 1] !== 0 || diff.data[i + 2] !== 0) continue;
      area.left = Math.min(area.left, x);
      area.right = Math.max(area.right, x);
      area.top = Math.min(area.top, y);
      area.bottom = Math.max(area.bottom, y);
    }
  }
  return area;
}

function cropArea(changed, width, height) {
  let left = Math.max(0, changed.left - margin);
  let right = Math.min(width, changed.right + 1 + margin);
  if (right - left < minCropWidth) {
    const center = Math.round((left + right) / 2);
    left = Math.max(0, Math.min(width - minCropWidth, center - minCropWidth / 2));
    right = Math.min(width, left + minCropWidth);
  }
  const top = Math.max(0, changed.top - margin);
  const bottom = Math.min(height, changed.bottom + 1 + margin, top + maxCropHeight);
  return { left, top, right, bottom, continues: changed.bottom + 1 + margin > bottom && bottom < height };
}

function pad(png, width, height) {
  if (png.width === width && png.height === height) return png;
  const padded = new PNG({ width, height });
  for (let i = 0; i < padded.data.length; i += 4) padded.data.set(padColor, i);
  PNG.bitblt(png, padded, 0, 0, png.width, png.height, 0, 0);
  return padded;
}

function crop(png, { left, top, right, bottom }) {
  const cropped = new PNG({ width: right - left, height: bottom - top });
  PNG.bitblt(png, cropped, left, top, right - left, bottom - top, 0, 0);
  return cropped;
}

function readPng(path) {
  return PNG.sync.read(readFileSync(path));
}

async function writeSheet(path, panels, columns) {
  const figures = panels.map(({ label, png }) => {
    const source = `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
    return `<figure><figcaption>${label}</figcaption><img src="${source}" width="${png.width}" height="${png.height}"></figure>`;
  });
  await sheet.setViewportSize({ width: 4000, height: 1000 });
  await sheet.setContent(`<!doctype html>
<style>
  body { margin: 0; background: #1b1b1b; }
  #sheet { display: inline-grid; grid-template-columns: repeat(${columns}, max-content); gap: 16px; padding: 16px; align-items: start; }
  figure { margin: 0; }
  figcaption { margin-bottom: 8px; color: #ddd; font: 600 22px/1.2 sans-serif; }
  img { display: block; outline: 1px solid #444; }
</style>
<div id="sheet">${figures.join('')}</div>`);
  await sheet.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
  const box = await sheet.locator('#sheet').boundingBox();
  await sheet.screenshot({ path, fullPage: true, clip: box });
}

function url(path) {
  return `${urlPrefix}${path}${urlSuffix}`;
}

function countLine(results) {
  const pages = new Set(results.map((result) => result.page)).size;
  const counts = ['changed', 'new', 'removed', 'unchanged']
    .map((status) => [status, results.filter((result) => result.status === status).length])
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${count} ${status}`);
  return `${results.length} screenshots of ${pages} pages: ${counts.join(', ') || 'none'}`;
}

function summary(results, pages) {
  const lines = [`**${countLine(results)}.**`, ''];
  if (!hasBase) lines.push('There are no base screenshots, so every screenshot is reported as new.', '');
  const shown = results.filter((result) => result.status !== 'unchanged');
  lines.push('#### Changes', '');
  if (shown.length === 0) lines.push('No page looks different from the base.', '');
  const shownImages = new Map();
  for (const result of shown) {
    lines.push(`**${result.page}, ${result.variant}**: ${describe(result)}`, '');
    const hash = createHash('sha256').update(readFileSync(join(outDir, 'changes', result.file))).digest('hex');
    const same = shownImages.get(hash);
    if (same === undefined) {
      shownImages.set(hash, result);
      lines.push(`![${result.page} ${result.variant}](${url(`changes/${result.file}`)})`, '');
    } else {
      lines.push(`The images are the same as for ${same.page}, ${same.variant}.`, '');
    }
  }
  if (pages.length > 0) lines.push('#### Pages', '', 'The first screen of every page. The links open the full page.', '');
  for (const { page, sheets } of pages) {
    const links = results
      .filter((result) => result.page === page && result.status !== 'removed')
      .map((result) => `[${result.variant}](${url(`full/${result.file}`)})`);
    lines.push(`**${page}**: ${links.join(' · ')}`, '');
    for (const sheet of sheets) {
      const image = `![${page} ${sheet.label}](${url(`pages/${sheet.name}`)})`;
      if (sheet.open) lines.push(image, '');
      else lines.push(`<details><summary>${page}, ${sheet.label}</summary>`, '', image, '', '</details>', '');
    }
  }
  return `${lines.join('\n')}\n`;
}

function describe(result) {
  const rows = `rows ${result.top} to ${result.bottom} of ${result.height}`;
  if (result.status === 'new') return `new page, ${rows}${result.continues ? ', the page continues below' : ''}.`;
  if (result.status === 'removed') return `removed page, ${rows}${result.continues ? ', the page continues below' : ''}.`;
  const columns = `columns ${result.left} to ${result.right}`;
  const continues = result.continues ? ', and the difference continues below' : '';
  return `${formatPercent(result.ratio)} of pixels differ; shown are ${rows} and ${columns}${continues}.`;
}

function formatPercent(ratio) {
  const percent = ratio * 100;
  return percent < 0.1 ? 'under 0.1%' : `${percent.toFixed(1)}%`;
}
