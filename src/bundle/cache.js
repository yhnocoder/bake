import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const TOOLCHAIN = [
  ['vite'],
  ['rolldown', 'vite'],
  ['lightningcss', 'vite'],
  ['vite-plugin-solid'],
  ['@babel/core', 'vite-plugin-solid'],
  ['babel-preset-solid', 'vite-plugin-solid'],
  ['babel-plugin-jsx-dom-expressions', 'babel-preset-solid'],
  ['solid-js'],
];
const QUERY = /\?.*$/;
const RENAME_TARGET_EXISTS = ['EEXIST', 'ENOTEMPTY'];
const MTIME_RESOLUTION = 2000;

export function filesIn(paths) {
  return paths
    .flatMap((path) =>
      statSync(path).isFile()
        ? [path]
        : readdirSync(path, { recursive: true, withFileTypes: true })
            .filter((entry) => entry.isFile())
            .map((entry) => join(entry.parentPath, entry.name)),
    )
    .sort();
}

export function buildCache(name, slot, base) {
  const dir = join(tmpdir(), `bake-${name}`);
  const location = digest(slot).slice(0, 16);
  const indexFile = join(dir, `${location}.json`);
  const stored = (file) => (base !== undefined && file.startsWith(`${base}${sep}`) ? relative(base, file) : file);
  const restored = (path) => (base === undefined ? path : resolve(base, path));

  function read(required) {
    const index = readIndex(indexFile);
    if (index === null || !isDeepStrictEqual(index.toolchain, toolchainVersions())) return null;
    const inputs = index.inputs.map(([path, hash]) => [restored(path), hash]);
    const listed = new Set(inputs.map(([file]) => file));
    if (!required.every((file) => listed.has(file))) return null;
    try {
      if (!inputs.every(([file, hash]) => hashOf(file) === hash)) return null;
      const output = join(dir, index.dir);
      return { data: index.data, files: index.files.map((path) => ({ path, source: readFileSync(join(output, path)) })), inputs: [...listed] };
    } catch {
      return null;
    }
  }

  function write(data, files, inputs, started) {
    const sources = [...new Set(inputs.map((id) => id.replace(QUERY, '')).filter((file) => isAbsolute(file)))].sort();
    // A file saved during the build would be stored with its new hash next to the output built from its old content.
    if (sources.some((file) => (statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0) >= started - MTIME_RESOLUTION)) return;
    mkdirSync(dir, { recursive: true });
    const folder = `${location}-${outputDigest(files).slice(0, 16)}`;
    const output = join(dir, folder);
    if (!existsSync(output)) {
      const staging = join(dir, `${location}.${randomUUID()}`);
      for (const file of files) {
        mkdirSync(dirname(join(staging, file.path)), { recursive: true });
        writeFileSync(join(staging, file.path), file.source);
      }
      try {
        renameSync(staging, output);
      } catch (error) {
        rmSync(staging, { recursive: true, force: true });
        if (!RENAME_TARGET_EXISTS.includes(error.code)) throw error;
      }
    }
    const index = { toolchain: toolchainVersions(), inputs: sources.map((file) => [stored(file), hashOf(file)]), data, dir: folder, files: files.map((file) => file.path) };
    const staging = `${indexFile}.${randomUUID()}`;
    writeFileSync(staging, JSON.stringify(index));
    renameSync(staging, indexFile);
    for (const other of readdirSync(dir)) {
      if (other.startsWith(`${location}-`) && other !== folder) rmSync(join(dir, other), { recursive: true, force: true });
    }
  }

  return { read, write };
}

function toolchainVersions() {
  const packages = new Map();
  for (const [name, dependent] of TOOLCHAIN) packages.set(name, findPackageJSON(name, dependent === undefined ? import.meta.url : packages.get(dependent)));
  return Object.fromEntries([...packages].map(([name, file]) => [name, JSON.parse(readFileSync(file, 'utf8')).version]));
}

function readIndex(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function hashOf(file) {
  const stats = statSync(file, { throwIfNoEntry: false });
  if (stats === undefined) return null;
  return stats.isFile() ? digest(readFileSync(file)) : 'directory';
}

function outputDigest(files) {
  const hash = createHash('sha256');
  for (const file of files) hash.update(`${file.path}\0${file.source.length}\0`).update(file.source);
  return hash.digest('hex');
}

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}
