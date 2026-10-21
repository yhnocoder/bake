import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import { contentType } from '../../src/content-types.js';
import { serve } from './browser.js';

test('the test server closes while a browser holds a connection that has not sent a request yet', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'bake-serve-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'index.html'), '<p>Home</p>');
  const closers = [];
  const origin = await serve({ after: (close) => closers.push(close) }, dir);
  assert.equal(await (await fetch(`${origin}/`)).text(), '<p>Home</p>');
  const socket = connect(Number(new URL(origin).port), '127.0.0.1');
  t.after(() => socket.destroy());
  await new Promise((done) => socket.once('connect', done));
  await wait(100);
  const closed = Promise.all(closers.map((close) => close())).then(() => 'closed');
  const open = wait(5000, 'still open', { ref: false });
  assert.equal(await Promise.race([closed, open]), 'closed');
});

test('the test server sends the content type that Bake gives each published file', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'bake-serve-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const files = ['page.html', 'photo.jpg', 'photo.jpeg', 'clip.gif', 'still.avif', 'module.mjs', 'font.ttf', 'style.css', 'script.js'];
  for (const file of files) writeFileSync(join(dir, file), 'x');
  const origin = await serve(t, dir);
  for (const file of files) {
    const response = await fetch(`${origin}/${file}`);
    await response.arrayBuffer();
    assert.equal(response.headers.get('content-type'), contentType(file), file);
  }
});
