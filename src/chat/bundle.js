import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import solid from 'vite-plugin-solid';
import { mathModules, publicModules } from '../bundle/modules.js';
import { BAKE_ROOT, browserBuild } from '../bundle/vite.js';

export const CHAT_PREAMBLE_PATH = '_bake/preamble.json';

const ENTRY = join(import.meta.dirname, 'entry.js');
const BUILD_DIRS = [import.meta.dirname, join(import.meta.dirname, '../bundle')];
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
const LOCATION = digest(BAKE_ROOT).slice(0, 16);
const CACHE_DIR = join(tmpdir(), 'bake-chat');
const INDEX_FILE = join(CACHE_DIR, `${LOCATION}.json`);
const QUERY = /\?.*$/;
const RENAME_TARGET_EXISTS = ['EEXIST', 'ENOTEMPTY'];

let bundle = null;

export function chatBundle() {
  bundle ??= Promise.resolve(cachedBundle() ?? buildBundle());
  return bundle;
}

function cachedBundle() {
  const index = readIndex();
  if (index === null || !isDeepStrictEqual(index.toolchain, toolchainVersions())) return null;
  const listed = new Set(index.inputs.map(([file]) => file));
  if (!buildFiles().every((file) => listed.has(file))) return null;
  try {
    if (!index.inputs.every(([file, hash]) => digest(readFileSync(file)) === hash)) return null;
    const dir = join(CACHE_DIR, index.dir);
    return { entry: index.entry, files: index.files.map((path) => ({ path, source: readFileSync(join(dir, path)) })) };
  } catch {
    return null;
  }
}

async function buildBundle() {
  const { entry, files, modules } = await browserBuild({
    input: { chat: ENTRY },
    plugins: [mathModules(fetchedPreamble(`../${CHAT_PREAMBLE_PATH}`)), solid()],
    alias: publicModules('chat'),
    format: 'es',
  });
  const sources = modules.filter((id) => !id.startsWith('\0')).map((id) => id.replace(QUERY, ''));
  storeBundle(entry, files, [...new Set([...buildFiles(), ...sources])]);
  return { entry, files };
}

function fetchedPreamble(address) {
  return [
    `const path = ${JSON.stringify(address)};`,
    'const address = new URL(path, import.meta.url);',
    'const response = await fetch(address);',
    "if (!response.ok) throw new Error(`${address} answered ${response.status}`);",
    'export const definitions = await response.json();',
    '',
  ].join('\n');
}

function toolchainVersions() {
  const packages = new Map();
  for (const [name, dependent] of TOOLCHAIN) packages.set(name, findPackageJSON(name, dependent === undefined ? import.meta.url : packages.get(dependent)));
  return Object.fromEntries([...packages].map(([name, file]) => [name, JSON.parse(readFileSync(file, 'utf8')).version]));
}

function buildFiles() {
  return BUILD_DIRS.flatMap((dir) =>
    readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(dir, entry.name)),
  ).sort();
}

function storeBundle(entry, files, inputs) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const name = `${LOCATION}-${outputDigest(files).slice(0, 16)}`;
  const dir = join(CACHE_DIR, name);
  if (!existsSync(dir)) {
    const staging = join(CACHE_DIR, `${LOCATION}.${randomUUID()}`);
    for (const file of files) {
      mkdirSync(dirname(join(staging, file.path)), { recursive: true });
      writeFileSync(join(staging, file.path), file.source);
    }
    try {
      renameSync(staging, dir);
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      if (!RENAME_TARGET_EXISTS.includes(error.code)) throw error;
    }
  }
  const index = { toolchain: toolchainVersions(), inputs: inputs.map((file) => [file, digest(readFileSync(file))]), entry, dir: name, files: files.map((file) => file.path) };
  const staging = `${INDEX_FILE}.${randomUUID()}`;
  writeFileSync(staging, JSON.stringify(index));
  renameSync(staging, INDEX_FILE);
  for (const other of readdirSync(CACHE_DIR)) {
    if (other.startsWith(`${LOCATION}-`) && other !== name) rmSync(join(CACHE_DIR, other), { recursive: true, force: true });
  }
}

function readIndex() {
  try {
    return JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function outputDigest(files) {
  const hash = createHash('sha256');
  for (const file of files) hash.update(`${file.path}\0${file.source.length}\0`).update(file.source);
  return hash.digest('hex');
}

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}
