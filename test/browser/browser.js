import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { serialize } from 'node:v8';
import { test as base } from '@playwright/test';
import { serveStatic } from '../../src/dev/static-server.js';

export { expect } from '@playwright/test';

export const test = base.extend({
  // The blog that the tests open: the example blog with the files added, or with example: false a blog of only the files. localhost serves it at localhost, where the AI chat appears.
  blog: [{}, { option: true }],
  sites: [
    async ({}, use) => {
      const sites = new Map();
      await use(sites);
      for (const site of sites.values()) await site.close();
    },
    { scope: 'worker' },
  ],
  site: async ({ blog, sites }, use) => {
    const { example = true, files = {}, localhost = false } = blog;
    const key = JSON.stringify([example, files, localhost]);
    if (!sites.has(key)) {
      const dir = builtSite(example, files);
      const server = await serveStatic(join(dir, 'dist'), { localhost });
      sites.set(key, { dir, origin: server.origin, close: server.close });
    }
    await use(sites.get(key));
  },
  baseURL: async ({ site }, use) => use(site.origin),
  // Opens a context or a page with options of its own at the address of the blog, closed when the test ends
  newContext: async ({ browser, baseURL }, use) => {
    const contexts = [];
    await use(async (options = {}) => {
      const context = await browser.newContext({ baseURL, ...options });
      contexts.push(context);
      return context;
    });
    for (const context of contexts) await context.close();
  },
  newPage: async ({ newContext }, use) => use(async (options) => (await newContext(options)).newPage()),
  // Registers a function that runs when the test ends, as t.after of node:test does, so createBlog({ after }, files) works in a browser test
  after: async ({}, use) => {
    const cleanups = [];
    await use((cleanup) => cleanups.push(cleanup));
    for (const cleanup of cleanups.reverse()) await cleanup();
  },
});

// why: Playwright compiles the modules that a test process imports, which then reads the bake.config.js of a blog as CommonJS, so blogs are built in a plain Node process
export function builtSite(example, files = {}) {
  const result = spawnSync(process.execPath, [join(import.meta.dirname, 'built-site.js')], { input: serialize({ example, files }), encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
}

// why: the same compilation would read the bake.config.js of the blog as CommonJS in bake dev too, so bake dev runs as its command does
export async function startDev(dir) {
  const child = spawn(process.execPath, [join(import.meta.dirname, '../../src/cli.js'), 'dev', '--port', '0', '--no-open'], { cwd: dir });
  const dev = { output: '', errors: '' };
  child.stderr.on('data', (chunk) => {
    dev.errors += chunk;
  });
  dev.url = await new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      dev.output += chunk;
      const serving = /^Serving the blog at (\S+)$/m.exec(dev.output);
      if (serving !== null) resolve(serving[1]);
    });
    child.once('exit', () => reject(new Error(`bake dev exited: ${dev.errors}`)));
  });
  dev.close = async () => {
    if (child.exitCode !== null) return;
    child.kill();
    await once(child, 'exit');
  };
  return dev;
}

export function luminance(color) {
  const values = color.match(/[\d.]+/g).map(Number);
  const [r, g, b] = color.startsWith('color(') ? values.slice(0, 3).map((value) => value * 255) : values;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export async function scrollInSteps(page, delta) {
  for (let step = 0; step < 5; step += 1) {
    await page.evaluate((amount) => window.scrollBy(0, amount), delta / 5);
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
  }
}

// The AI chat asks for a passkey, which this authenticator creates and confirms without a person
export async function addPasskeyAuthenticator(context, page, { prf = true } = {}) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: prf, automaticPresenceSimulation: true },
  });
  return { cdp, authenticatorId };
}

export function settle(target) {
  return target.evaluate(async (element) => {
    const frame = () => new Promise((done) => requestAnimationFrame(done));
    await document.fonts.ready;
    await frame();
    await frame();
    const roots = [document, ...[...document.querySelectorAll('*')].flatMap((host) => host.shadowRoot ?? [])];
    const all = element === undefined ? roots.flatMap((root) => root.getAnimations()) : element.getAnimations({ subtree: true });
    // why: an animation driven by scrolling never finishes, and one inside a subtree that content-visibility hides does not advance
    const animations = all.filter((animation) => animation.playState === 'running' && animation.timeline instanceof DocumentTimeline && animation.effect?.getComputedTiming().endTime !== Infinity && animation.effect.target?.checkVisibility() !== false);
    // why: Chromium sometimes leaves the finished promise of a finished CSS transition pending, so the play state is read in every frame
    while (animations.some((animation) => animation.playState === 'running')) await frame();
    await frame();
  });
}
