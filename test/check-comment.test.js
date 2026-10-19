import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

const checker = join(import.meta.dirname, '../scripts/check_comment.py');

describe('comment check', () => {
  let dir;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'bake-comment-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function check(name, source) {
    const file = join(dir, name);
    writeFileSync(file, source);
    return spawnSync('python3', [checker, file], { encoding: 'utf8' });
  }

  test('accepts code without comments, tool directives and a shebang', () => {
    const result = check('clean.js', '#!/usr/bin/env node\n// eslint-disable-next-line no-console\nconsole.log("// not a comment");\n');
    assert.equal(result.status, 0, result.stdout);
  });

  test('accepts a one-line why: reason', () => {
    const result = check('why.js', 'const delay = 16; // why: one frame, slower updates drop keystrokes\n');
    assert.equal(result.status, 0, result.stdout);
  });

  test('rejects an ordinary comment with its file and line', () => {
    const result = check('plain.js', 'const a = 1;\n// add one\nconst b = a + 1;\n');
    assert.equal(result.status, 1);
    assert.match(result.stdout, /plain\.js:2: \/\/ add one/);
  });

  test('rejects the old why(#N) form', () => {
    const result = check('old.py', 'x = 1  # why(#12): reason\n');
    assert.equal(result.status, 1);
  });

  test('rejects a Python docstring', () => {
    const result = check('doc.py', 'def f():\n    """Return one."""\n    return 1\n');
    assert.equal(result.status, 1);
    assert.match(result.stdout, /doc\.py:2: docstring/);
  });
});
