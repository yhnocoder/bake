import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { diffArrays } from 'diff';
import pixelmatch from 'pixelmatch';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { variants } from './screenshot-variants.js';

export const maxImageWidth = 880;
export const sheetPadding = 4;
export const sheetGap = 16;
export const maxPanelWidth = maxImageWidth - 2 * sheetPadding;
const margin = 80;
const minCropWidth = 640;
const maxCropHeight = 1200;
const maxAreas = 4;
const maxEditRows = 6000;
const diffTimeout = 20000;
const shiftTolerance = 16;
const padColor = [128, 128, 128, 255];

if (import.meta.main) await main(process.argv.slice(2));

async function main([baseDir, headDir, outDir]) {
  if (baseDir === undefined || headDir === undefined || outDir === undefined) {
    console.error('Usage: node scripts/compare-screenshots.js <base dir> <head dir> <output dir>');
    process.exit(2);
  }
  rmSync(outDir, { recursive: true, force: true });
  for (const dir of ['changes', 'pages']) mkdirSync(join(outDir, dir), { recursive: true });

  const baseShots = screenshots(baseDir);
  const headShots = screenshots(headDir);
  const browser = await chromium.launch();
  const sheet = await browser.newPage();
  try {
    const shots = [];
    const changes = [];
    for (const file of sortShots([...new Set([...baseShots, ...headShots])])) {
      const before = baseShots.includes(file) ? readPng(join(baseDir, file)) : undefined;
      const after = headShots.includes(file) ? readPng(join(headDir, file)) : undefined;
      const { areas = [], ...result } = { ...parseShot(file), ...compareShot(before, after) };
      const name = file.replace(/\.png$/, '');
      const shown = areas.map(({ panels, ...area }, index) => ({ ...area, image: `${name}.${index + 1}.png` }));
      const shot = { ...result, areas: shown };
      shots.push(shot);
      if (shot.status === 'unchanged') continue;
      const change = { ...shot, hash: hashPanels(areas.flatMap((area) => area.panels)) };
      if (!addToGroups(changes, change)) continue;
      for (const [index, area] of areas.entries()) await writeSheet(sheet, join(outDir, 'changes', shown[index].image), area.panels);
    }
    const pages = [];
    for (const page of new Set(shots.filter((shot) => shot.status !== 'removed').map((shot) => shot.page))) {
      pages.push({ page, images: await writeOverview(sheet, headDir, outDir, page) });
    }
    writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(shots, null, 2)}\n`);
    writeFileSync(join(outDir, 'summary.md'), summary({ results: shots, changes, pages, hasBase: existsSync(baseDir) }));
    console.log(countLine(shots));
  } finally {
    await browser.close();
  }
}

function screenshots(dir) {
  return existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith('.png')) : [];
}

export function parseShot(file) {
  const name = file.replace(/\.png$/, '');
  const dot = name.lastIndexOf('.');
  const variant = variants.find((item) => item.name === name.slice(dot + 1));
  return { file, page: name.slice(0, dot), variant: variant.name, device: variant.device, colorScheme: variant.colorScheme };
}

function sortShots(files) {
  const order = (file) => variants.findIndex((item) => item.name === parseShot(file).variant);
  return files.sort((a, b) => parseShot(a).page.localeCompare(parseShot(b).page) || order(a) - order(b));
}

export function compareShot(before, after) {
  if (before === undefined) return topOfPage(after, 'new', 'New page', 'after');
  if (after === undefined) return topOfPage(before, 'removed', 'Removed page', 'before');
  const width = Math.max(before.width, after.width);
  const wideBefore = pad(before, width, before.height);
  const wideAfter = pad(after, width, after.height);
  const areas = changedRows(wideBefore, wideAfter)
    .map((rows) => changedArea(wideBefore, wideAfter, rows))
    .filter((area) => area !== undefined);
  if (areas.length === 0) return { status: 'unchanged' };
  return { status: 'changed', beforeHeight: before.height, afterHeight: after.height, areas: areas.slice(0, maxAreas), hiddenAreas: Math.max(0, areas.length - maxAreas) };
}

function rowHashes(png) {
  const rowBytes = png.width * 4;
  return Array.from({ length: png.height }, (_, y) => createHash('sha1').update(png.data.subarray(y * rowBytes, (y + 1) * rowBytes)).digest('base64'));
}

export function changedRows(before, after) {
  const beforeHashes = rowHashes(before);
  const afterHashes = rowHashes(after);
  const exact = diffArrays(beforeHashes, afterHashes, { maxEditLength: maxEditRows, timeout: diffTimeout });
  if (exact === undefined) return [outerRows(beforeHashes, afterHashes)];
  const beforeRange = neighbourRange(before);
  const afterRange = neighbourRange(after);
  const same = (beforeRow, afterRow) => beforeHashes[beforeRow] === afterHashes[afterRow]
    || (withinRange(before, beforeRow, afterRange(afterRow)) && withinRange(after, afterRow, beforeRange(beforeRow)));
  const visible = (edit) => edit.beforeEnd - edit.beforeStart > 1 || edit.afterEnd - edit.afterStart > 1;
  const range = (start, end) => Array.from({ length: end - start }, (_, index) => start + index);
  return mergeEdits(mergeEdits(edits(exact, 0, 0)).flatMap((group) => {
    const changes = diffArrays(range(group.beforeStart, group.beforeEnd), range(group.afterStart, group.afterEnd), { comparator: same, timeout: diffTimeout });
    return changes === undefined ? [group] : edits(changes, group.beforeStart, group.afterStart);
  }).filter(visible));
}

function edits(changes, beforeStart, afterStart) {
  const list = [];
  let beforeRow = beforeStart;
  let afterRow = afterStart;
  for (const change of changes) {
    if (!change.added && !change.removed) {
      beforeRow += change.count;
      afterRow += change.count;
      continue;
    }
    const last = list.at(-1);
    if (last === undefined || last.beforeEnd !== beforeRow || last.afterEnd !== afterRow) {
      list.push({ beforeStart: beforeRow, beforeEnd: beforeRow, afterStart: afterRow, afterEnd: afterRow });
    }
    if (change.removed) beforeRow += change.count;
    else afterRow += change.count;
    Object.assign(list.at(-1), { beforeEnd: beforeRow, afterEnd: afterRow });
  }
  return list;
}

function mergeEdits(list) {
  const groups = [];
  for (const edit of list) {
    const last = groups.at(-1);
    if (last !== undefined && edit.beforeStart - last.beforeEnd < 2 * margin) Object.assign(last, { beforeEnd: edit.beforeEnd, afterEnd: edit.afterEnd });
    else groups.push({ ...edit });
  }
  return groups;
}

export function neighbourRange(png) {
  const rowBytes = png.width * 4;
  const horizontal = new Map();
  const ranges = new Map();
  const spread = (row) => {
    if (horizontal.has(row)) return horizontal.get(row);
    const start = row * rowBytes;
    const low = new Uint8Array(rowBytes);
    const high = new Uint8Array(rowBytes);
    for (let i = 0; i < rowBytes; i += 1) {
      const left = i >= 4 ? png.data[start + i - 4] : png.data[start + i];
      const right = i + 4 < rowBytes ? png.data[start + i + 4] : png.data[start + i];
      low[i] = Math.min(left, png.data[start + i], right);
      high[i] = Math.max(left, png.data[start + i], right);
    }
    horizontal.set(row, { low, high });
    return horizontal.get(row);
  };
  return (row) => {
    if (ranges.has(row)) return ranges.get(row);
    const [above, middle, below] = [Math.max(0, row - 1), row, Math.min(png.height - 1, row + 1)].map(spread);
    const low = new Uint8Array(rowBytes);
    const high = new Uint8Array(rowBytes);
    for (let i = 0; i < rowBytes; i += 1) {
      low[i] = Math.min(above.low[i], middle.low[i], below.low[i]);
      high[i] = Math.max(above.high[i], middle.high[i], below.high[i]);
    }
    ranges.set(row, { low, high });
    return ranges.get(row);
  };
}

export function withinRange(png, row, { low, high }) {
  const start = row * png.width * 4;
  for (let i = 0; i < low.length; i += 1) {
    if ((i & 3) === 3) continue;
    const value = png.data[start + i];
    if (value + shiftTolerance < low[i] || value > high[i] + shiftTolerance) return false;
  }
  return true;
}

function outerRows(beforeRows, afterRows) {
  const shorter = Math.min(beforeRows.length, afterRows.length);
  let top = 0;
  while (top < shorter && beforeRows[top] === afterRows[top]) top += 1;
  let bottom = 0;
  while (bottom < shorter - top && beforeRows.at(-1 - bottom) === afterRows.at(-1 - bottom)) bottom += 1;
  return { beforeStart: top, beforeEnd: beforeRows.length - bottom, afterStart: top, afterEnd: afterRows.length - bottom };
}

function changedArea(before, after, rows) {
  const columns = changedColumns(before, after, rows);
  if (columns === undefined) return undefined;
  const { left, right } = cropColumns(columns, before.width);
  const beforeArea = { left, right, ...cropRows(rows.beforeStart, rows.beforeEnd, before.height) };
  const afterArea = { left, right, ...cropRows(rows.afterStart, rows.afterEnd, after.height) };
  const beforePanel = crop(before, beforeArea);
  const afterPanel = crop(after, afterArea);
  const panels = [{ label: 'Before', png: beforePanel }, { label: 'After', png: afterPanel }];
  if (rows.beforeEnd - rows.beforeStart === rows.afterEnd - rows.afterStart && beforePanel.height === afterPanel.height) {
    const diff = new PNG({ width: afterPanel.width, height: afterPanel.height });
    pixelmatch(beforePanel.data, afterPanel.data, diff.data, diff.width, diff.height, { threshold: 0.1 });
    panels.push({ label: 'Diff', png: diff });
  }
  return { left, right, before: beforeArea, after: afterArea, panels };
}

export function changedColumns(before, after, { beforeStart, beforeEnd, afterStart, afterEnd }) {
  const height = beforeEnd - beforeStart;
  if (height === afterEnd - afterStart) {
    const strip = (png, top) => crop(png, { left: 0, right: png.width, top, bottom: top + height });
    const diff = new PNG({ width: before.width, height });
    if (pixelmatch(strip(before, beforeStart).data, strip(after, afterStart).data, diff.data, diff.width, height, { threshold: 0.1 }) === 0) return undefined;
    const { left, right } = changedPixels(diff);
    return { left, right };
  }
  const pixel = (png, x, y) => png.data.readUInt32BE((y * png.width + x) * 4);
  const referenceRow = afterStart > 0 ? afterStart - 1 : Math.min(afterEnd, after.height - 1);
  const columns = { left: before.width, right: -1 };
  for (let x = 0; x < before.width; x += 1) {
    const color = pixel(after, x, referenceRow);
    let changed = false;
    for (let y = beforeStart; y < beforeEnd && !changed; y += 1) changed = pixel(before, x, y) !== color;
    for (let y = afterStart; y < afterEnd && !changed; y += 1) changed = pixel(after, x, y) !== color;
    if (!changed) continue;
    columns.left = Math.min(columns.left, x);
    columns.right = x;
  }
  return columns.right === -1 ? { left: 0, right: before.width - 1 } : columns;
}

export function cropColumns(changed, width) {
  let left = Math.max(0, changed.left - margin);
  let right = Math.min(width, changed.right + 1 + margin);
  if (right - left < minCropWidth) {
    const center = Math.round((left + right) / 2);
    left = Math.max(0, Math.min(width - minCropWidth, center - minCropWidth / 2));
    right = Math.min(width, left + minCropWidth);
  }
  return { left, right };
}

export function cropRows(start, end, height) {
  const top = Math.max(0, start - margin);
  const bottom = Math.min(height, end + margin, top + maxCropHeight);
  return { top, bottom, continues: bottom < Math.min(height, end + margin) };
}

function topOfPage(png, status, label, side) {
  const area = { left: 0, right: png.width, top: 0, bottom: Math.min(png.height, maxCropHeight) };
  area.continues = area.bottom < png.height;
  return { status, [`${side}Height`]: png.height, areas: [{ left: 0, right: png.width, [side]: area, panels: [{ label, png: crop(png, area) }] }], hiddenAreas: 0 };
}

export function addToGroups(groups, item) {
  const same = groups.find((group) => group.page === item.page && group.device === item.device && group.hash === item.hash);
  if (same !== undefined) {
    same.colorSchemes.push(item.colorScheme);
    return false;
  }
  groups.push({ ...item, colorSchemes: [item.colorScheme] });
  return true;
}

async function writeOverview(sheet, headDir, outDir, page) {
  const images = [];
  for (const device of [...new Set(variants.map((variant) => variant.device))]) {
    const groups = [];
    const screens = new Map();
    for (const variant of variants.filter((item) => item.device === device)) {
      const file = `${page}.${variant.name}.png`;
      if (!existsSync(join(headDir, file))) continue;
      const png = readPng(join(headDir, file));
      const screen = crop(png, { left: 0, top: 0, right: Math.min(png.width, variant.width), bottom: Math.min(png.height, variant.height) });
      const item = { page, device, colorScheme: variant.colorScheme, hash: hashPanels([{ png: screen }]) };
      if (addToGroups(groups, item)) screens.set(item.hash, screen);
    }
    if (groups.length === 0) continue;
    const panels = groups.map((group) => {
      const screen = screens.get(group.hash);
      return { label: `${device}, ${group.colorSchemes.join(' and ')}`, png: screen };
    });
    const name = `${page}.${device}.png`;
    await writeSheet(sheet, join(outDir, 'pages', name), panels);
    images.push({ name, label: device });
  }
  return images;
}

function hashPanels(panels) {
  const hash = createHash('sha256');
  for (const { png } of panels) hash.update(`${png.width}x${png.height}`).update(png.data);
  return hash.digest('hex');
}

export function changedPixels(diff) {
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

export function sheetColumns(widths) {
  const widest = Math.min(Math.max(...widths), maxPanelWidth);
  for (let columns = widths.length; columns > 1; columns -= 1) {
    if (columns * widest + (columns - 1) * sheetGap + 2 * sheetPadding <= maxImageWidth) return columns;
  }
  return 1;
}

export function pad(png, width, height) {
  if (png.width === width && png.height === height) return png;
  const padded = new PNG({ width, height });
  for (let i = 0; i < padded.data.length; i += 4) padded.data.set(padColor, i);
  PNG.bitblt(png, padded, 0, 0, png.width, png.height, 0, 0);
  return padded;
}

export function crop(png, { left, top, right, bottom }) {
  const cropped = new PNG({ width: right - left, height: bottom - top });
  PNG.bitblt(png, cropped, left, top, right - left, bottom - top, 0, 0);
  return cropped;
}

function readPng(path) {
  return PNG.sync.read(readFileSync(path));
}

async function writeSheet(sheet, path, panels) {
  const figures = panels.map(({ label, png }) => {
    const source = `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
    return `<figure><figcaption>${label}</figcaption><img src="${source}" width="${png.width}" height="${png.height}"></figure>`;
  });
  await sheet.setViewportSize({ width: maxImageWidth, height: 1000 });
  await sheet.setContent(`<!doctype html>
<style>
  body { margin: 0; background: #fff; }
  #sheet { display: inline-grid; grid-template-columns: repeat(${sheetColumns(panels.map(({ png }) => png.width))}, max-content); gap: 20px ${sheetGap}px; padding: ${sheetPadding}px; background: #fff; align-items: start; }
  figure { margin: 0; }
  figcaption { margin-bottom: 6px; color: #59636e; font: 600 14px/1.4 -apple-system, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
  img { display: block; max-width: ${maxPanelWidth}px; height: auto; outline: 1px solid #d1d9e0; }
</style>
<div id="sheet">${figures.join('')}</div>`);
  await sheet.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
  const box = await sheet.locator('#sheet').boundingBox();
  await sheet.screenshot({ path, fullPage: true, clip: box });
}

function countLine(results) {
  const pages = new Set(results.map((result) => result.page)).size;
  const counts = ['changed', 'new', 'removed', 'unchanged']
    .map((status) => [status, results.filter((result) => result.status === status).length])
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${count} ${status}`);
  return `${results.length} screenshots of ${pages} pages: ${counts.join(', ') || 'none'}`;
}

export function summary({ results, changes, pages, hasBase }) {
  const lines = [`**${countLine(results)}.**`];
  if (!hasBase) lines.push('There are no base screenshots, so every screenshot is reported as new.');
  if (changes.length === 0) lines.push('No page looks different from the base.');
  lines.push('');
  if (changes.length > 0) {
    const changedPages = [...new Set(changes.map((change) => change.page))];
    lines.push(details(`Changes on ${listPages(changedPages)}`, changes.flatMap((change) => [
      `**${change.page}, ${change.device}, ${change.colorSchemes.join(' and ')}**: ${describe(change)}`,
      '',
      ...change.areas.flatMap((area, index) => [
        ...(change.areas.length > 1 ? [`Area ${index + 1}: ${describeArea(area)}`, ''] : []),
        `![${change.page} ${change.device}](changes/${area.image})`,
        '',
      ]),
    ])));
  }
  if (pages.length > 0) {
    lines.push(details(`First screen of ${listPages(pages.map(({ page }) => page))}`, pages.map(({ page, images }) => {
      return details(page, [
        ...images.flatMap((image) => [`![${page} ${image.label}](pages/${image.name})`, '']),
      ]);
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

export function describe(change) {
  if (change.status !== 'changed') {
    const height = change.afterHeight ?? change.beforeHeight;
    const shown = change.areas[0].after ?? change.areas[0].before;
    return `${change.status === 'new' ? 'New' : 'Removed'} page, ${height} pixels tall${shown.continues ? `. Shown: the top ${shown.bottom} rows` : ''}.`;
  }
  const count = change.areas.length + change.hiddenAreas;
  const areas = `${count} changed ${count === 1 ? 'area' : 'areas'}`;
  const difference = change.afterHeight - change.beforeHeight;
  const height = difference === 0
    ? `the page keeps its height of ${change.afterHeight} pixels`
    : `the page is ${Math.abs(difference)} pixels ${difference > 0 ? 'taller' : 'shorter'}`;
  const hidden = change.hiddenAreas > 0 ? ` Only the first ${change.areas.length} are shown.` : '';
  const only = change.areas.length === 1 ? ` ${describeArea(change.areas[0])}` : '';
  return `${areas}; ${height}.${only}${hidden}`;
}

export function describeArea({ left, right, before, after }) {
  const rows = before.top === after.top && before.bottom === after.bottom
    ? `Rows ${after.top} to ${after.bottom}`
    : `Rows ${before.top} to ${before.bottom} before and ${after.top} to ${after.bottom} after`;
  const continues = before.continues || after.continues ? '; the area continues below' : '';
  return `${rows}, columns ${left} to ${right}${continues}.`;
}
