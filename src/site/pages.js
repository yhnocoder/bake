import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { isMap, LineCounter, parseDocument } from 'yaml';
import { isSlug } from '../format/frontmatter.js';

const skippedDirectories = new Set(['notes', 'components', 'assets']);
const frontmatterBlock = /^---\r?\n([\s\S]*?\r?\n)?---(?:\r?\n|$)/;

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

function readFrontmatter(source) {
  const block = frontmatterBlock.exec(source);
  const lineCounter = new LineCounter();
  const document = parseDocument(block?.[1] ?? '', { lineCounter });
  if (document.errors.length > 0 || !isMap(document.contents)) return { frontmatter: {} };
  const slugKey = document.contents.items.find((pair) => pair.key?.value === 'slug')?.key;
  const { line, col } = lineCounter.linePos(slugKey?.range[0] ?? 0);
  return { frontmatter: document.toJS(), slugPoint: { line: line + 1, column: col } };
}

export async function findPages(root) {
  const content = join(root, 'content');
  const files = await markdownFiles(content).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const pages = [];
  const messages = [];
  const owners = new Map();
  const paths = files.map((file) => relative(root, file)).filter((path) => !basename(path).startsWith('_'));
  for (const path of paths.sort((a, b) => (a < b ? -1 : 1))) {
    const { frontmatter, slugPoint } = readFrontmatter(await readFile(join(root, path), 'utf8'));
    const url = pageUrl(frontmatter.slug);
    if (url !== null) {
      const owner = owners.get(url);
      if (owner) messages.push({ path, ...slugPoint, text: `Slug ${frontmatter.slug} is already used by ${owner}` });
      else owners.set(url, path);
    }
    pages.push({ path, url, frontmatter });
  }
  return { pages, messages };
}
