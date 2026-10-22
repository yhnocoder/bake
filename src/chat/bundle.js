import { join } from 'node:path';
import solid from 'vite-plugin-solid';
import { buildCache, filesIn } from '../bundle/cache.js';
import { mathModules, publicModules } from '../bundle/modules.js';
import { BAKE_ROOT, browserBuild } from '../bundle/vite.js';

export const CHAT_PREAMBLE_PATH = '_bake/preamble.json';

const ENTRY = join(import.meta.dirname, 'entry.js');
const BUILD_DIRS = [import.meta.dirname, join(import.meta.dirname, '../bundle')];
const cache = buildCache('chat', BAKE_ROOT);

export async function chatBundle() {
  return cachedBundle() ?? buildBundle();
}

function cachedBundle() {
  const cached = cache.read(filesIn(BUILD_DIRS));
  return cached === null ? null : { entry: cached.data.entry, files: cached.files };
}

async function buildBundle() {
  const started = Date.now();
  const { entry, files, modules } = await browserBuild({
    input: { chat: ENTRY },
    plugins: [mathModules(fetchedPreamble(`../${CHAT_PREAMBLE_PATH}`)), solid()],
    alias: publicModules('chat'),
  });
  cache.write({ entry }, files, [...filesIn(BUILD_DIRS), ...modules], started);
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
