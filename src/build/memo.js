import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const QUERY = /\?.*$/;
const CHANGED_DURING_COMPUTE = Symbol('changed during compute');

// An entry keeps the value of its compute function with everything the function read: the files, folders and Vite modules of the reader, and the parts of the context it selected. It is reused while all of them are as they were.
export function createMemo(root) {
  const entries = new Map();
  let update = 0;
  let changed = null;
  let states = new Map();

  // Only the dependencies under the changed paths are read again; null reads every dependency again.
  function startUpdate(changedPaths) {
    update += 1;
    changed = changedPaths;
    states = new Map();
  }

  function get(key, context, compute) {
    const entry = entries.get(key);
    if (entry?.update === update) return entry.value;
    const next = { update, dependencies: [] };
    next.value = (async () => {
      if (entry !== undefined && (await succeeded(entry.value)) && entry.dependencies.every((dependency) => isCurrent(dependency, context))) {
        next.dependencies = entry.dependencies;
        return entry.value;
      }
      const files = reader(next.dependencies, context);
      try {
        return await compute(files);
      } finally {
        files.close();
      }
    })();
    next.value.catch(() => {
      if (entries.get(key) === next) entries.delete(key);
    });
    entries.set(key, next);
    return next.value;
  }

  // Entries that the update did not ask for belong to articles, themes or components that are gone.
  function sweep() {
    for (const [key, entry] of entries) if (entry.update !== update) entries.delete(key);
  }

  function reader(dependencies, context) {
    let open = true;
    const add = (dependency) => {
      if (!open) throw new Error(`${dependency.path ?? 'a value'} was read after the value that depends on it was computed`);
      dependencies.push(dependency);
    };
    const record = (path, probe) => {
      const state = probe(path);
      add({ path, probe, state });
      return state;
    };
    return {
      root,
      read(path, encoding) {
        const content = statSync(path, { throwIfNoEntry: false })?.isFile() ? readFileSync(path) : null;
        add({ path, probe: contentHash, state: content === null ? null : digest(content) });
        return content === null || encoding === undefined ? content : content.toString(encoding);
      },
      stat(path) {
        record(path, kindAndSize);
        return statSync(path, { throwIfNoEntry: false });
      },
      list(dir) {
        return record(dir, listing) ?? [];
      },
      // why: hashing the modules of Bake and of node_modules on every update would cost more than the whole update; they do not change while Bake runs
      modules(ids, started) {
        const files = new Set(ids.map((id) => id.replace(QUERY, '')).filter((file) => isAbsolute(file) && inRoot(file)));
        for (const file of files) {
          const modified = statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0;
          add({ path: file, probe: contentHash, state: modified >= started ? CHANGED_DURING_COMPUTE : contentHash(file) });
        }
      },
      value(select) {
        const value = select(context);
        add({ select, value });
        return value;
      },
      // A result that may depend on any file, such as a build that failed before it named its modules, is computed again on every update.
      everything() {
        add({ everything: true });
      },
      close() {
        open = false;
      },
    };
  }

  function isCurrent(dependency, context) {
    if (dependency.everything) return false;
    if (dependency.select !== undefined) return isDeepStrictEqual(dependency.select(context), dependency.value);
    if (!mayHaveChanged(dependency.path)) return true;
    const id = `${dependency.probe.name}\0${dependency.path}`;
    if (!states.has(id)) states.set(id, dependency.probe(dependency.path));
    return isDeepStrictEqual(states.get(id), dependency.state);
  }

  // why: the watcher reports a folder that was created, moved or removed as one path, so a path also changes the files under it and the folders that hold it
  function mayHaveChanged(path) {
    if (changed === null) return true;
    if (!inRoot(path)) return false;
    const name = relative(root, path).split(sep).join('/');
    return name === '' || changed.some((other) => name === other || name.startsWith(`${other}/`) || other.startsWith(`${name}/`));
  }

  function inRoot(path) {
    const name = relative(root, path);
    return name === '' || (!name.startsWith('..') && !isAbsolute(name));
  }

  return { startUpdate, get, sweep };
}

async function succeeded(promise) {
  try {
    await promise;
    return true;
  } catch {
    return false;
  }
}

function contentHash(path) {
  return statSync(path, { throwIfNoEntry: false })?.isFile() ? digest(readFileSync(path)) : null;
}

function kindAndSize(path) {
  const stats = statSync(path, { throwIfNoEntry: false });
  if (stats === undefined) return null;
  return stats.isFile() ? `file ${stats.size}` : stats.isDirectory() ? 'directory' : 'other';
}

function listing(dir) {
  return statSync(dir, { throwIfNoEntry: false })?.isDirectory() ? readdirSync(dir).sort() : null;
}

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}
