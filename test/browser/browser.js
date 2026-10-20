import { join } from 'node:path';
import { after } from 'node:test';
import { chromium } from 'playwright';
import { serveStatic } from '../../scripts/static-server.js';
import { exampleBuild } from '../blog.js';

let browser = null;
after(() => browser?.then((launched) => launched.close()));

export function launchBrowser() {
  browser ??= chromium.launch();
  return browser;
}

export async function serve(t, dir, options) {
  const server = await serveStatic(dir, options);
  t.after(server.close);
  return server.origin;
}

export function serveExample(t, options) {
  return serve(t, join(exampleBuild(), 'dist'), options);
}

export function settle(page) {
  return page.evaluate(async () => {
    const frame = () => new Promise((done) => requestAnimationFrame(done));
    await document.fonts.ready;
    await frame();
    await frame();
    const finite = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity);
    await Promise.all(finite.map((animation) => animation.finished.catch(() => {})));
    await frame();
  });
}
