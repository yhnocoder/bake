import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { build } from 'vite';
import solid from 'vite-plugin-solid';
import { BAKE_ROOT, outputOf, viteConfig } from '../build/vite.js';
import { chatModules, isMathJaxModule } from '../components/modules.js';

export const CHAT_PREAMBLE_PATH = '_bake/preamble.json';

const ENTRY = join(import.meta.dirname, 'entry.js');
const BUILD_FILES = [import.meta.filename, join(import.meta.dirname, '../components/modules.js'), join(import.meta.dirname, '../build/vite.js'), join(BAKE_ROOT, 'package.json')];
const CACHE_DIR = join(tmpdir(), 'bake-chat');
const INDEX_FILE = join(CACHE_DIR, `${digest(BAKE_ROOT).slice(0, 16)}.json`);
const QUERY = /\?.*$/;

let bundle = null;

export function chatBundle() {
  bundle ??= Promise.resolve(cachedBundle() ?? buildBundle());
  return bundle;
}

function cachedBundle() {
  const index = readIndex();
  if (index === null) return null;
  try {
    if (!index.inputs.every(([file, hash]) => digest(readFileSync(file)) === hash)) return null;
    const dir = join(CACHE_DIR, index.dir);
    return { entry: index.entry, files: index.files.map((path) => ({ path, source: readFileSync(join(dir, path)) })) };
  } catch {
    return null;
  }
}

async function buildBundle() {
  const result = await build({
    ...viteConfig([chatModules(`../${CHAT_PREAMBLE_PATH}`), solid()]),
    base: './',
    build: {
      write: false,
      cssCodeSplit: true,
      assetsInlineLimit: 0,
      modulePreload: { polyfill: false },
      rolldownOptions: {
        input: { chat: ENTRY },
        output: {
          format: 'es',
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
          codeSplitting: { groups: [{ name: 'mathjax', test: isMathJaxModule }] },
        },
      },
    },
  });
  const outputs = outputOf(result);
  const entry = outputs.find((output) => output.type === 'chunk' && output.isEntry).fileName;
  const files = outputs.map((output) => ({ path: output.fileName, source: output.type === 'chunk' ? output.code : output.source }));
  const modules = outputs.flatMap((output) => (output.type === 'chunk' ? output.moduleIds : [])).filter((id) => !id.startsWith('\0'));
  storeBundle(entry, files, [...new Set([...BUILD_FILES, ...modules.map((id) => id.replace(QUERY, ''))])]);
  return { entry, files };
}

function storeBundle(entry, files, inputs) {
  const previous = readIndex();
  const name = randomUUID();
  const dir = join(CACHE_DIR, name);
  for (const file of files) {
    mkdirSync(dirname(join(dir, file.path)), { recursive: true });
    writeFileSync(join(dir, file.path), file.source);
  }
  const staging = `${INDEX_FILE}.${name}`;
  const index = { inputs: inputs.map((file) => [file, digest(readFileSync(file))]), entry, dir: name, files: files.map((file) => file.path) };
  writeFileSync(staging, JSON.stringify(index));
  renameSync(staging, INDEX_FILE);
  if (previous !== null) rmSync(join(CACHE_DIR, previous.dir), { recursive: true, force: true });
}

function readIndex() {
  try {
    return JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}
