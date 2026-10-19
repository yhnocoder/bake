import { readdirSync, statSync, watch } from 'node:fs';
import { join, sep } from 'node:path';

const IGNORED_FOLDERS = new Set(['node_modules']);
const IGNORED_ROOT_FOLDERS = new Set(['dist']);
const SETTLE_TIME = 40;

export function isWatched(path) {
  const segments = path.split('/');
  if (IGNORED_ROOT_FOLDERS.has(segments[0])) return false;
  return segments.every((segment) => segment !== '' && !segment.startsWith('.') && !IGNORED_FOLDERS.has(segment));
}

export function watchBlog(root, onChange) {
  const known = new Set(listWatchedFiles(root));
  let pending = new Set();
  let timer;
  const flush = () => {
    const changed = [...pending].filter((path) => {
      const exists = statSync(join(root, path), { throwIfNoEntry: false }) !== undefined;
      const wasKnown = known.has(path) || [...known].some((file) => file.startsWith(`${path}/`));
      return exists || wasKnown;
    });
    pending = new Set();
    for (const path of changed) {
      for (const file of [...known]) if (file === path || file.startsWith(`${path}/`)) known.delete(file);
      for (const file of listWatchedFiles(join(root, path), path)) known.add(file);
    }
    if (changed.length > 0) onChange(changed.sort());
  };
  const watcher = watch(root, { recursive: true }, (_event, filename) => {
    if (filename === null) return;
    const path = filename.toString().split(sep).join('/');
    if (!isWatched(path)) return;
    pending.add(path);
    clearTimeout(timer);
    timer = setTimeout(flush, SETTLE_TIME);
  });
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}

function listWatchedFiles(path, prefix = '') {
  const stats = statSync(path, { throwIfNoEntry: false });
  if (stats === undefined) return [];
  if (!stats.isDirectory()) return prefix === '' ? [] : [prefix];
  return readdirSync(path)
    .map((name) => (prefix === '' ? name : `${prefix}/${name}`))
    .filter(isWatched)
    .flatMap((child) => listWatchedFiles(join(path, child.split('/').at(-1)), child));
}
