import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import { serve } from './server.js';

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
