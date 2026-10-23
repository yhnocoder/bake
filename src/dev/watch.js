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
  // why: macOS also reports writes made a moment before fs.watch started, so a path counts as changed only when the ctimes of its files differ from those read when watching started or at its last change; a write, a rename or a change of metadata sets ctime, which no tool can set back
  const known = new Map(listWatchedFiles(root));
  let pending = new Set();
  let timer;
  const within = (file, path) => file === path || file.startsWith(`${path}/`);
  const flush = () => {
    const listed = new Map([...pending].map((path) => [path, listWatchedFiles(join(root, path), path)]));
    pending = new Set();
    const changed = [...listed].filter(([path, files]) => {
      const before = [...known.keys()].filter((file) => within(file, path));
      return before.length !== files.length || files.some(([file, ctime]) => known.get(file) !== ctime);
    });
    for (const [path, files] of listed) {
      for (const file of [...known.keys()]) if (within(file, path)) known.delete(file);
      for (const [file, ctime] of files) known.set(file, ctime);
    }
    if (changed.length > 0) onChange(changed.map(([path]) => path).sort());
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

// The watched files under a path with their ctimes
function listWatchedFiles(path, prefix = '') {
  const stats = statSync(path, { throwIfNoEntry: false });
  if (stats === undefined) return [];
  if (!stats.isDirectory()) return prefix === '' ? [] : [[prefix, stats.ctimeMs]];
  return readdirSync(path)
    .map((name) => (prefix === '' ? name : `${prefix}/${name}`))
    .filter(isWatched)
    .flatMap((child) => listWatchedFiles(join(path, child.split('/').at(-1)), child));
}
