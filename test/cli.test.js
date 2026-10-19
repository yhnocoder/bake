import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, test } from 'node:test';
import { cli } from './blog.js';

function bake(...args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

describe('bake cli', () => {
  test('--help lists new, dev and build and exits 0', () => {
    const result = bake('--help');
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^Usage: bake <command>/);
    for (const command of ['new <path>', 'dev', 'build']) assert.match(result.stdout, new RegExp(`^  ${command} `, 'm'));
  });

  test('dev reports not implemented and exits 1', () => {
    const result = bake('dev');
    assert.equal(result.status, 1);
    assert.equal(result.stderr, 'bake dev: not implemented yet\n');
  });

  test('no command prints usage to stderr and exits 1', () => {
    const result = bake();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^Usage: bake <command>/);
  });

  test('unknown command is named in the error', () => {
    const result = bake('publish');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^Unknown command publish\n/);
  });
});
