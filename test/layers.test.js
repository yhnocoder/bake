import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, test } from 'node:test';
import { parseSync } from 'vite';
import { PUBLIC_MODULES } from '../src/bundle/modules.js';

const SRC = join(import.meta.dirname, '../src');
const SCRIPT = /\.jsx?$/;
const QUERY = /\?.*$/;
const STRING_LITERAL = /^(['"`])([^'"`$]*)\1$/;
const publicFiles = new Map(PUBLIC_MODULES.map((module) => [module.name, module.file]));
const scripts = readdirSync(SRC, { recursive: true })
  .filter((path) => SCRIPT.test(path))
  .map((path) => join(SRC, path))
  .sort();
const imports = new Map(scripts.map((file) => [file, importsOf(file)]));

function importsOf(file) {
  const code = readFileSync(file, 'utf8');
  const { module } = parseSync(file, code);
  const dynamic = module.dynamicImports.map((entry) => STRING_LITERAL.exec(code.slice(entry.moduleRequest.start, entry.moduleRequest.end))?.[2]);
  const specifiers = [
    ...module.staticImports.map((entry) => entry.moduleRequest.value),
    ...module.staticExports.flatMap((entry) => entry.entries.map((item) => item.moduleRequest?.value)),
    ...dynamic,
  ].filter((specifier) => specifier !== undefined && specifier !== null);
  return [...new Set(specifiers)].map((specifier) => ({ specifier, target: targetOf(file, specifier) }));
}

function targetOf(file, specifier) {
  if (publicFiles.has(specifier)) return publicFiles.get(specifier);
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null;
  return resolve(dirname(file), specifier.replace(QUERY, ''));
}

function layerOf(file) {
  const parts = relative(SRC, file).split(sep);
  return parts.length === 1 ? parts[0] : `${parts[0]}/`;
}

function name(file) {
  return relative(join(SRC, '..'), file).split(sep).join('/');
}

function layerGraph() {
  const graph = new Map();
  for (const [file, list] of imports) {
    const from = layerOf(file);
    if (!graph.has(from)) graph.set(from, new Set());
    for (const { target } of list) {
      if (target !== null && target.startsWith(`${SRC}${sep}`) && layerOf(target) !== from) graph.get(from).add(layerOf(target));
    }
  }
  return graph;
}

function cycles(graph) {
  const found = [];
  const done = new Set();
  const visit = (node, path) => {
    if (path.includes(node)) {
      found.push([...path.slice(path.indexOf(node)), node].join(' -> '));
      return;
    }
    if (done.has(node)) return;
    for (const next of graph.get(node) ?? []) visit(next, [...path, node]);
    done.add(node);
  };
  for (const node of [...graph.keys()].sort()) visit(node, []);
  return found;
}

function browserModules() {
  const entries = [...scripts.filter((file) => file.startsWith(join(SRC, 'themes', sep))), join(SRC, 'chat/entry.js'), join(SRC, 'components/runtime.js'), ...publicFiles.values()];
  const reached = new Set();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop();
    if (reached.has(file) || !imports.has(file)) continue;
    reached.add(file);
    for (const { target } of imports.get(file)) if (target !== null) queue.push(target);
  }
  return [...reached].sort();
}

describe('layers of src/', () => {
  test('the directories of src/ import each other without a cycle', () => {
    assert.deepEqual(cycles(layerGraph()), []);
  });

  test('src/build/ is imported only by src/cli.js and src/dev/', () => {
    const allowed = new Set(['build/', 'cli.js', 'dev/']);
    const offending = [...imports].flatMap(([file, list]) =>
      allowed.has(layerOf(file)) ? [] : list.filter(({ target }) => target !== null && layerOf(target) === 'build/').map(({ specifier }) => `${name(file)} imports ${specifier}`),
    );
    assert.deepEqual(offending, []);
  });

  test('the modules that run in the browser import no Node built-in module', () => {
    const modules = browserModules();
    assert.ok(modules.includes(join(SRC, 'chat/bubbles.jsx')));
    assert.ok(modules.includes(join(SRC, 'kit/plot.jsx')));
    const offending = modules.flatMap((file) => imports.get(file).filter(({ specifier }) => isBuiltin(specifier)).map(({ specifier }) => `${name(file)} imports ${specifier}`));
    assert.deepEqual(offending, []);
  });
});
