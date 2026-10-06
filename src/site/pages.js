import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import { isSlug, readFrontmatter } from '../format/frontmatter.js';

const skippedDirectories = new Set(['notes', 'components', 'assets']);

export async function markdownFiles(path) {
  const info = await stat(path);
  if (!info.isDirectory()) return [path];
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) files.push(...(await markdownFiles(child)));
    } else if (entry.name.endsWith('.md')) {
      files.push(child);
    }
  }
  return files;
}

export function pageUrl(slug) {
  if (!isSlug(slug)) return null;
  return slug === '/' ? '/' : `/${slug}/`;
}

function byPath(a, b) {
  return a.path < b.path ? -1 : 1;
}

export function isPagePath(path) {
  const segments = path.split(sep);
  return segments[0] === 'content' && path.endsWith('.md') && !basename(path).startsWith('_') && !segments.slice(1, -1).some((segment) => skippedDirectories.has(segment));
}

async function readPage(root, path) {
  const { values: frontmatter, keyPlaces } = readFrontmatter(await readFile(join(root, path), 'utf8'));
  return { path, url: pageUrl(frontmatter.slug), frontmatter, slugPlace: keyPlaces.get('slug') };
}

function slugMessages(pages) {
  const messages = [];
  const owners = new Map();
  for (const { path, url, frontmatter, slugPlace } of pages) {
    if (url === null) continue;
    const owner = owners.get(url);
    if (owner) messages.push({ path, line: slugPlace.line, column: slugPlace.column, text: `Slug ${frontmatter.slug} is already used by ${owner}` });
    else owners.set(url, path);
  }
  return messages;
}

export async function findPages(root) {
  const content = join(root, 'content');
  const files = await markdownFiles(content).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const pages = [];
  const paths = files.map((file) => relative(root, file)).filter(isPagePath);
  for (const path of paths.sort()) pages.push(await readPage(root, path));
  return { pages, messages: slugMessages(pages) };
}

export async function updatePage(root, pages, path) {
  const others = pages.filter((page) => page.path !== path);
  const next = [...others, await readPage(root, path)].sort(byPath);
  return { pages: next, messages: slugMessages(next) };
}

export function removePage(pages, path) {
  const next = pages.filter((page) => page.path !== path);
  return { pages: next, messages: slugMessages(next) };
}
