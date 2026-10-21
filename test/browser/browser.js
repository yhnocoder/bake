import assert from 'node:assert/strict';
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

export async function until(check, message) {
  const deadline = Date.now() + 5000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, message);
    await new Promise((done) => setTimeout(done, 20));
  }
}

export async function serve(t, dir, options) {
  const server = await serveStatic(dir, options);
  t.after(server.close);
  return server.origin;
}

export function serveExample(t, options) {
  return serve(t, join(exampleBuild(), 'dist'), options);
}

export function nextFrame(page) {
  return page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
}

export function settle(target) {
  return target.evaluate(async (element) => {
    const frame = () => new Promise((done) => requestAnimationFrame(done));
    await document.fonts.ready;
    await frame();
    await frame();
    const roots = [document, ...[...document.querySelectorAll('*')].flatMap((host) => host.shadowRoot ?? [])];
    const all = element === undefined ? roots.flatMap((root) => root.getAnimations()) : element.getAnimations({ subtree: true });
    // why: an animation inside a subtree that content-visibility hides does not advance
    const animations = all.filter((animation) => animation.playState === 'running' && animation.effect?.getComputedTiming().endTime !== Infinity && animation.effect.target?.checkVisibility() !== false);
    // why: Chromium sometimes leaves the finished promise of a finished CSS transition pending, so the play state is read in every frame
    while (animations.some((animation) => animation.playState === 'running')) await frame();
    await frame();
  });
}
