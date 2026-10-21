import { readdirSync, statSync, watch } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';

const IGNORED_FOLDERS = new Set(['node_modules']);
const IGNORED_ROOT_FOLDERS = new Set(['dist']);
const SETTLE_TIME = 40;

export function isWatched(path) {
  const segments = path.split('/');
  if (IGNORED_ROOT_FOLDERS.has(segments[0])) return false;
  return segments.every((segment) => segment !== '' && !segment.startsWith('.') && !IGNORED_FOLDERS.has(segment));
}

export function watchBlog(root, onChange, onError) {
  const started = Date.now();
  const known = new Set(listWatchedFiles(root));
  let pending = new Set();
  let timer;
  const flush = () => {
    const changed = [...pending].filter((path) => {
      const stats = statSync(join(root, path), { throwIfNoEntry: false });
      // why: macOS also reports writes made a moment before fs.watch started; a write, a rename or a change of metadata sets ctime, which no tool can set back
      if (stats !== undefined) return stats.ctimeMs >= started;
      return known.has(path) || [...known].some((file) => file.startsWith(`${path}/`));
    });
    pending = new Set();
    for (const path of changed) {
      for (const file of [...known]) if (file === path || file.startsWith(`${path}/`)) known.delete(file);
      for (const file of listWatchedFiles(join(root, path), path)) known.add(file);
    }
    if (changed.length > 0) onChange(changed.sort());
  };
  let stopped = false;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    watcher.close();
    parentWatcher.close();
  };
  const fail = (error) => {
    if (stopped) return;
    stop();
    onError(error);
  };
  const watcher = watch(root, { recursive: true }, (_event, filename) => {
    if (stopped) return;
    if (statSync(root, { throwIfNoEntry: false }) === undefined) return fail(new Error('the folder no longer exists'));
    if (filename === null) return;
    const path = filename.toString().split(sep).join('/');
    if (!isWatched(path)) return;
    pending.add(path);
    clearTimeout(timer);
    timer = setTimeout(flush, SETTLE_TIME);
  });
  watcher.on('error', fail);
  const parentWatcher = watch(dirname(root), (_event, filename) => {
    if (stopped || filename?.toString() !== basename(root)) return;
    if (statSync(root, { throwIfNoEntry: false }) === undefined) fail(new Error('the folder no longer exists'));
  });
  parentWatcher.on('error', fail);
  return stop;
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
