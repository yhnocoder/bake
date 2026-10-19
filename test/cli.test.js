import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { rmSync } from 'node:fs';
import { describe, test } from 'node:test';
import { cli, createBlog, validConfig } from './blog.js';

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

  test('dev outside a blog root reports the missing bake.config.js and exits 1', (t) => {
    const dir = createBlog(t, {});
    const result = spawnSync(process.execPath, [cli, 'dev'], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stderr, 'bake.config.js:1:1 bake.config.js not found, run bake from the blog root\n');
  });

  test('dev rejects a port that is not a number', () => {
    const result = bake('dev', '--port', 'http');
    assert.equal(result.status, 1);
    assert.equal(result.stderr, 'Usage: bake dev [--port <number>]\n');
  });

  test('dev prints the address it serves and stops on an interrupt', { timeout: 30000 }, async (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig });
    const child = spawn(process.execPath, [cli, 'dev', '--port', '0'], { cwd: dir });
    t.after(() => child.kill());
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (/Serving the blog at http:\/\/localhost:\d+\/\n/.test(output)) child.kill('SIGINT');
    });
    const [code] = await once(child, 'exit');
    assert.match(output, /^Serving the blog at http:\/\/localhost:\d+\/\n/);
    assert.equal(code, 0);
  });

  test('dev reports a blog folder it can no longer watch and exits 1', { timeout: 30000 }, async (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig });
    const child = spawn(process.execPath, [cli, 'dev', '--port', '0'], { cwd: dir });
    t.after(() => child.kill());
    let output = '';
    let errors = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (/Serving the blog at /.test(output)) rmSync(dir, { recursive: true, force: true });
    });
    child.stderr.on('data', (chunk) => {
      errors += chunk;
    });
    const [code] = await once(child, 'exit');
    assert.equal(errors, `bake dev: cannot watch ${dir}: the folder no longer exists\n`);
    assert.equal(code, 1);
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
