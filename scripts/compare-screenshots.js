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
  const shots = [];
  const changes = [];
  for (const file of sortShots([...new Set([...baseShots, ...headShots])])) {
    if (headShots.includes(file)) copyFileSync(join(headDir, file), join(outDir, 'full', file));
    const { panels, ...shot } = { ...parseShot(file), ...compareShot(file) };
    shots.push(shot);
    if (shot.status !== 'unchanged') await addChange(changes, shot, panels);
  }
  const pages = [];
  for (const page of new Set(shots.filter((shot) => shot.status !== 'removed').map((shot) => shot.page))) {
    pages.push({ page, images: await writeOverview(page) });
  }
  writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(shots, null, 2)}\n`);
  writeFileSync(join(outDir, 'summary.md'), summary(shots, changes, pages));
  console.log(countLine(shots));
} finally {
  await browser.close();
}

function screenshots(dir) {
  return existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith('.png')) : [];
}

function parseShot(file) {
  const name = file.replace(/\.png$/, '');
  const dot = name.lastIndexOf('.');
  const variant = variants.find((item) => item.name === name.slice(dot + 1));
  return { file, page: name.slice(0, dot), variant: variant.name, device: variant.device, colorScheme: variant.colorScheme };
}

function sortShots(files) {
  const order = (file) => variants.findIndex((item) => item.name === parseShot(file).variant);
  return files.sort((a, b) => parseShot(a).page.localeCompare(parseShot(b).page) || order(a) - order(b));
}

function compareShot(file) {
  if (!baseShots.includes(file)) return topOfPage(join(headDir, file), 'new', 'New page');
  if (!headShots.includes(file)) return topOfPage(join(baseDir, file), 'removed', 'Removed page');
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
  const panels = [
    { label: 'Before', png: crop(paddedBefore, area) },
    { label: 'After', png: crop(paddedAfter, area) },
    { label: 'Diff', png: crop(diff, area) },
  ];
  return { status: 'changed', ratio: pixels / (width * height), ...area, height, panels };
}

function topOfPage(path, status, label) {
  const png = readPng(path);
  const area = { left: 0, top: 0, right: png.width, bottom: Math.min(png.height, maxCropHeight) };
  return { status, ...area, height: png.height, continues: area.bottom < png.height, panels: [{ label, png: crop(png, area) }] };
}

async function addChange(changes, shot, panels) {
  const hash = hashPanels(panels);
  const same = changes.find((change) => change.page === shot.page && change.device === shot.device && change.hash === hash);
  if (same !== undefined) {
    same.colorSchemes.push(shot.colorScheme);
    return;
  }
  const columns = panels.length === 3 && panels[0].png.width <= maxSideBySideWidth ? 3 : 1;
  await writeSheet(join(outDir, 'changes', shot.file), panels, columns);
  changes.push({ ...shot, hash, colorSchemes: [shot.colorScheme] });
}

async function writeOverview(page) {
  const images = [];
  for (const device of [...new Set(variants.map((variant) => variant.device))]) {
    const panels = [];
    for (const variant of variants.filter((item) => item.device === device)) {
      const file = `${page}.${variant.name}.png`;
      if (!headShots.includes(file)) continue;
      const png = readPng(join(headDir, file));
      const firstScreen = crop(png, { left: 0, top: 0, right: png.width, bottom: Math.min(png.height, variant.height) });
      const same = panels.find((item) => item.hash === hashPanels([{ png: firstScreen }]));
      if (same !== undefined) same.colorSchemes.push(variant.colorScheme);
      else panels.push({ png: firstScreen, hash: hashPanels([{ png: firstScreen }]), colorSchemes: [variant.colorScheme], file });
    }
    const labeled = panels.map((item) => ({ ...item, label: `${device}, ${item.colorSchemes.join(' and ')}` }));
    if (labeled.length > 1 && labeled.every((item) => item.png.width <= maxSideBySideWidth)) {
      await writeSheet(join(outDir, 'pages', `${page}.${device}.png`), labeled, labeled.length);
      images.push({ name: `${page}.${device}.png`, label: device });
    } else {
      for (const item of labeled) {
        await writeSheet(join(outDir, 'pages', item.file), [item], 1);
        images.push({ name: item.file, label: item.label });
      }
    }
  }
  return images;
}

function hashPanels(panels) {
  const hash = createHash('sha256');
  for (const { png } of panels) hash.update(`${png.width}x${png.height}`).update(png.data);
  return hash.digest('hex');
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

function summary(results, changes, pages) {
  const lines = [`**${countLine(results)}.**`];
  if (!hasBase) lines.push('There are no base screenshots, so every screenshot is reported as new.');
  if (changes.length === 0) lines.push('No page looks different from the base.');
  lines.push('');
  if (changes.length > 0) {
    const changedPages = [...new Set(changes.map((change) => change.page))];
    lines.push(details(`Changes on ${listPages(changedPages)}`, changes.flatMap((change) => [
      `**${change.page}, ${change.device}, ${change.colorSchemes.join(' and ')}**: ${describe(change)}`,
      '',
      `![${change.page} ${change.device}](${url(`changes/${change.file}`)})`,
      '',
    ])));
  }
  if (pages.length > 0) {
    lines.push(details(`First screen of ${listPages(pages.map(({ page }) => page))}`, pages.flatMap(({ page, images }) => {
      const links = results
        .filter((result) => result.page === page && result.status !== 'removed')
        .map((result) => `[${result.device}, ${result.colorScheme}](${url(`full/${result.file}`)})`);
      return [
        details(page, [
          `Full pages: ${links.join(' · ')}`,
          '',
          ...images.flatMap((image) => [`![${page} ${image.label}](${url(`pages/${image.name}`)})`, '']),
        ]),
      ];
    })));
  }
  return `${lines.join('\n')}\n`;
}

function details(title, body) {
  return ['<details>', `<summary>${title}</summary>`, '', ...body, '</details>', ''].join('\n');
}

function listPages(pages) {
  return pages.length === 1 ? pages[0] : `${pages.length} pages: ${pages.join(', ')}`;
}

function describe(change) {
  const rows = `rows ${change.top} to ${change.bottom} of ${change.height}`;
  if (change.status !== 'changed') {
    return `${change.status} page. Shown: ${rows}${change.continues ? '; the page continues below' : ''}.`;
  }
  const continues = change.continues ? '; the difference continues below' : '';
  return `${formatPercent(change.ratio)} of pixels differ. Shown: ${rows}, columns ${change.left} to ${change.right}${continues}.`;
}

function formatPercent(ratio) {
  const percent = ratio * 100;
  return percent < 0.1 ? 'under 0.1%' : `${percent.toFixed(1)}%`;
}
