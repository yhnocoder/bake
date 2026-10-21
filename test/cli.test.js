import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { article, cli, createBlog, validConfig, writeFiles } from './blog.js';

function bake(...args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

describe('bake cli', () => {
  test('--help lists the commands and the options of dev, says why bake dev is opened at localhost and exits 0', () => {
    const result = bake('--help');
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^Usage: bake <command>/);
    for (const command of ['init \\[folder\\]', 'new <path>', 'dev', 'build']) assert.match(result.stdout, new RegExp(`^  ${command} `, 'm'));
    assert.match(result.stdout, /^  --no-open {10}Do not open the browser when bake dev starts$/m);
    assert.match(result.stdout, /^  --host <address> {3}Address that bake dev listens on, 127\.0\.0\.1 by default/m);
    assert.match(result.stdout, /^Open bake dev at localhost rather than 127\.0\.0\.1: the AI chat stores its key with a passkey,\nand browsers do not create passkeys for an IP address\.$/m);
  });

  test('dev outside a blog root reports the missing bake.config.js and exits 1', (t) => {
    const dir = createBlog(t, {});
    const result = spawnSync(process.execPath, [cli, 'dev'], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stderr, 'bake.config.js:1:1 bake.config.js not found, run bake from the blog root or create a blog with bake init\n');
  });

  test('dev rejects a port that is not a number and options that are unknown, repeated or without a value', () => {
    for (const args of [['--port', 'http'], ['--port', '70000'], ['--host'], ['--host', ''], ['--host', '--port'], ['--port', '0', '--port', '1'], ['--host', 'a', '--host', 'b'], ['--bind', '0.0.0.0'], ['--no-open', '--no-open'], ['--no-open=1']]) {
      const result = bake('dev', ...args);
      assert.equal(result.status, 1, args.join(' '));
      assert.equal(result.stderr, 'Usage: bake dev [--port <number>] [--host <address>] [--no-open]\n', args.join(' '));
    }
  });

  test('dev accepts --host and --port in either order, prints the address it serves and the network addresses only for a wildcard host, and stops on an interrupt', { timeout: 30000 }, async (t) => {
    const dir = createBlog(t, { 'bake.config.js': validConfig });
    const serve = async (args) => {
      const child = spawn(process.execPath, [cli, 'dev', ...args], { cwd: dir });
      t.after(() => child.kill());
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
        if (/Serving the blog at /.test(output)) setTimeout(() => child.kill('SIGINT'), 100);
      });
      const [code] = await once(child, 'exit');
      assert.equal(code, 0, output);
      return output;
    };
    const local = await serve(['--host', '127.0.0.1', '--no-open', '--port', '0']);
    assert.match(local, /^Serving the blog at http:\/\/localhost:\d+\/\n/);
    assert.doesNotMatch(local, /On the local network/);
    const wildcard = await serve(['--port', '0', '--host', '0.0.0.0']);
    assert.match(wildcard, /^Serving the blog at http:\/\/localhost:(\d+)\/\n(On the local network: http:\/\/[\d.]+:\1\/\n)*/);
  });

  async function removeWhileServing(t, remove) {
    const dir = createBlog(t, { 'bake.config.js': validConfig });
    const child = spawn(process.execPath, [cli, 'dev', '--port', '0'], { cwd: dir });
    t.after(() => child.kill());
    let output = '';
    let errors = '';
    let writing = null;
    let removed = false;
    t.after(() => clearInterval(writing));
    child.stdout.on('data', (chunk) => {
      output += chunk;
      // why: macOS starts reporting changes a moment after fs.watch returns and drops what happens before, so the file is written until bake dev reports it
      if (writing === null && /Serving the blog at /.test(output)) writing = setInterval(() => writeFiles(dir, { 'content/posts/rope/index.md': article() }), 200);
      if (!removed && /^Updated /m.test(output)) {
        removed = true;
        clearInterval(writing);
        remove(dir);
      }
    });
    child.stderr.on('data', (chunk) => {
      errors += chunk;
    });
    const [code] = await once(child, 'exit');
    assert.equal(errors, `bake dev: cannot watch ${dir}: the folder no longer exists\n`);
    assert.equal(code, 1);
  }

  test('dev reports a blog folder it can no longer watch and exits 1', { timeout: 30000 }, (t) =>
    removeWhileServing(t, (dir) => rmSync(dir, { recursive: true, force: true })),
  );

  test('dev reports a blog folder that is removed after its files and exits 1', { timeout: 30000 }, (t) =>
    removeWhileServing(t, (dir) => {
      rmSync(join(dir, 'bake.config.js'));
      setTimeout(() => rmSync(dir, { recursive: true, force: true }), 100);
    }),
  );

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
