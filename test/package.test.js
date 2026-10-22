import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PUBLIC_MODULES } from '../src/bundle/modules.js';

const root = join(import.meta.dirname, '..');

function packedFiles() {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout)[0].files.map((file) => file.path);
}

test('the npm package holds the tool, its license, the notices and the changelog and leaves out tests, examples and repository files', () => {
  const files = packedFiles();
  for (const file of ['package.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', 'src/cli.js', 'src/themes/essay/page.jsx', 'src/themes/bento/page.jsx', 'src/kit/index.js']) {
    assert.ok(files.includes(file), `${file} is missing from the package`);
  }
  const outside = files.filter((file) => !file.startsWith('src/') && !['package.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md'].includes(file));
  assert.deepEqual(outside, []);
});

test('the package is published as @yhnocoder/bake with the command bake, whose file is packed and starts with a node shebang', () => {
  const { name, bin } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(name, '@yhnocoder/bake');
  assert.deepEqual(Object.keys(bin), ['bake']);
  assert.ok(packedFiles().includes(bin.bake));
  assert.match(readFileSync(join(root, bin.bake), 'utf8'), /^#!\/usr\/bin\/env node\n/);
});

test('the package exports none of its modules, whose bake/ names only the build of themes and components resolves', () => {
  assert.equal(import.meta.resolve('@yhnocoder/bake/package.json'), new URL('../package.json', import.meta.url).href);
  const paths = ['src/cli.js', 'src/kit/index.js', ...PUBLIC_MODULES.map((module) => module.name.replace(/^bake\//, ''))];
  const exported = paths.filter((path) => {
    try {
      import.meta.resolve(`@yhnocoder/bake/${path}`);
      return true;
    } catch (error) {
      assert.equal(error.code, 'ERR_PACKAGE_PATH_NOT_EXPORTED', path);
      return false;
    }
  });
  assert.deepEqual(exported, []);
});
