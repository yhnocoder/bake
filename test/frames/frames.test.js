import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { bake } from '../blog.js';
import { serve } from '../browser/server.js';
import { describe, frameProblem, frameStats, openPage, paced, record, settle } from './frames.js';

const exampleBlog = join(import.meta.dirname, '../../examples/blog');
const everyInteraction = process.env.BAKE_FRAMES === 'all';

const SYNTAX = '/2026-10/syntax/';
const BENTO = '/2026-10/activations/';
const HOME = '/';

const WHEEL_STEP = 120;
const WHEEL_INTERVAL = 50;

const knownFailures = [];

function scroll(distance) {
  return async (page) => {
    const height = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    const length = Math.min(distance ?? height, height);
    await page.mouse.move(200, 400);
    return async () => {
      const steps = Math.ceil(length / WHEEL_STEP);
      await paced(steps, steps * WHEEL_INTERVAL, () => page.mouse.wheel(0, WHEEL_STEP));
      await settle(page, 300);
    };
  };
}

async function hoverSidenote(page, device) {
  const reference = page.locator('.bk-article .sidenote-ref a').nth(1);
  await reference.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await settle(page, 800);
  const box = await reference.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  return async () => {
    for (let round = 0; round < 3; round += 1) {
      if (device === 'phone') await page.mouse.click(x, y);
      else await page.mouse.move(x, y, { steps: 4 });
      await page.waitForTimeout(500);
      if (device !== 'phone') await page.mouse.move(x, y - 80, { steps: 4 });
      await page.waitForTimeout(500);
    }
  };
}

const TOC_ENTRIES = { ticks: '.bk-ticks .bk-tick', tabs: '.bk-tabs .bk-tab', dots: '.bk-dots .bk-dot-item' };

function hoverToc(style) {
  return async (page) => {
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight * 0.3));
    await settle(page, 1000);
    const points = await page.locator(TOC_ENTRIES[style]).evaluateAll((entries) =>
      entries.map((entry) => entry.getBoundingClientRect()).filter((box) => box.height > 0).map((box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })),
    );
    assert.ok(points.length > 1, `the ${style} table of contents shows its entries`);
    const [first, last] = [points[0], points.at(-1)];
    return async () => {
      await page.mouse.move(first.x, first.y);
      await page.waitForTimeout(500);
      await paced(40, 3000, (index) => page.mouse.move(first.x + ((last.x - first.x) * (index + 1)) / 40, first.y + ((last.y - first.y) * (index + 1)) / 40));
      await page.mouse.move(900, 450);
      await page.waitForTimeout(600);
    };
  };
}

async function openDrawer(page) {
  await page.evaluate(() => scrollTo(0, innerHeight * 3));
  await page.mouse.wheel(0, -200);
  await settle(page, 800);
  return async () => {
    for (let round = 0; round < 2; round += 1) {
      await page.locator('.bk-toc-handle').click();
      await page.waitForTimeout(700);
      await page.locator('.bk-drawer-close').click();
      await page.waitForTimeout(700);
    }
  };
}

async function changeTheme(page) {
  await page.evaluate(() => scrollTo(0, innerHeight * 2));
  await settle(page, 800);
  return async () => {
    const toggle = page.locator('.bk-settings-toggle');
    const choose = (value) => page.locator(`.bk-settings-panel button[data-value="${value}"]`).first().click();
    await toggle.click();
    await page.waitForTimeout(500);
    await choose('dark');
    await page.waitForTimeout(600);
    await choose('light');
    await page.waitForTimeout(600);
    await toggle.click();
    await page.waitForTimeout(500);
  };
}

async function openChat(page) {
  await page.locator('.bk-chat-launcher').waitFor();
  await settle(page, 500);
  return async () => {
    for (let round = 0; round < 2; round += 1) {
      await page.locator('.bk-chat-launcher').click();
      await page.waitForTimeout(700);
      await page.locator('.bk-chat-launcher').click();
      await page.waitForTimeout(700);
    }
  };
}

async function dragPlot(page) {
  const frame = page.locator('figure.component[data-component="act-fn-plot"]').first();
  await frame.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await page.waitForFunction((element) => element.dataset.state === 'ready', await frame.elementHandle());
  await settle(page, 1000);
  const slider = await frame.getByRole('slider').first().boundingBox();
  const plot = await frame.locator('svg').first().boundingBox();
  return async () => {
    const y = slider.y + slider.height / 2;
    await page.mouse.move(slider.x + 4, y);
    await page.mouse.down();
    await paced(40, 2000, (index) => page.mouse.move(slider.x + 4 + ((slider.width - 8) * (index + 1)) / 40, y));
    await page.mouse.up();
    await page.mouse.move(plot.x + 2, plot.y + plot.height / 2);
    await paced(50, 2500, (index) => page.mouse.move(plot.x + 2 + ((plot.width - 4) * (index + 1)) / 50, plot.y + plot.height / 2));
    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);
  };
}

async function toggleFold(page) {
  const summary = page.locator('.bk-article details.fold > summary').first();
  await summary.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await settle(page, 800);
  return async () => {
    for (let round = 0; round < 2; round += 1) {
      await summary.click();
      await page.waitForTimeout(700);
      await summary.click();
      await page.waitForTimeout(700);
    }
  };
}

async function resizeColumns(page) {
  return async () => {
    for (const width of [1200, 1000, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(800);
    }
  };
}

const BOTH = ['desktop', 'phone'];

const interactions = [
  { name: 'scrolling the first 8000 pixels of the syntax article', path: SYNTAX, devices: BOTH, prepare: scroll(8000) },
  { name: 'highlighting a sidenote of the syntax article', path: SYNTAX, devices: BOTH, prepare: hoverSidenote },
  { name: 'moving over the ticks table of contents of the syntax article', path: SYNTAX, devices: ['desktop'], storage: { 'bk-toc': 'ticks' }, prepare: hoverToc('ticks') },
  { name: 'changing the theme in the settings panel of the syntax article', path: SYNTAX, devices: BOTH, prepare: changeTheme },
  { name: 'scrolling the whole syntax article', path: SYNTAX, devices: BOTH, nightly: true, prepare: scroll() },
  { name: 'moving over the tabs table of contents of the syntax article', path: SYNTAX, devices: ['desktop'], storage: { 'bk-toc': 'tabs' }, nightly: true, prepare: hoverToc('tabs') },
  { name: 'moving over the dots table of contents of the syntax article', path: SYNTAX, devices: ['desktop'], storage: { 'bk-toc': 'dots' }, nightly: true, prepare: hoverToc('dots') },
  { name: 'opening and closing the table of contents drawer of the syntax article', path: SYNTAX, devices: ['phone'], nightly: true, prepare: openDrawer },
  { name: 'opening and closing the AI chat panel on the syntax article', path: SYNTAX, devices: BOTH, nightly: true, prepare: openChat },
  { name: 'dragging the slider of the function plot in the syntax article', path: SYNTAX, devices: BOTH, nightly: true, prepare: dragPlot },
  { name: 'opening and closing a fold of the syntax article', path: SYNTAX, devices: BOTH, nightly: true, prepare: toggleFold },
  { name: 'scrolling the whole bento article', path: BENTO, devices: BOTH, nightly: true, prepare: scroll() },
  { name: 'dragging the slider of the function plot in the bento article', path: BENTO, devices: BOTH, nightly: true, prepare: dragPlot },
  { name: 'resizing the bento article', path: BENTO, devices: ['desktop'], nightly: true, prepare: resizeColumns },
  { name: 'scrolling the whole homepage', path: HOME, devices: BOTH, nightly: true, prepare: scroll() },
];

function caseName(interaction, device) {
  return `${interaction.name} at ${device === 'phone' ? 375 : 1440} pixels`;
}

test('interactions draw every frame within the 60 fps budget on a CPU four times slower', async (t) => {
  const blog = mkdtempSync(join(tmpdir(), 'bake-frames-'));
  t.after(() => rmSync(blog, { recursive: true, force: true }));
  cpSync(exampleBlog, blog, { recursive: true, filter: (path) => !/[/\\](dist|node_modules)$/.test(path) });
  const built = bake(blog, 'build');
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const base = (await serve(t, join(blog, 'dist'))).replace('127.0.0.1', 'localhost');
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const interaction of interactions.filter((entry) => everyInteraction || !entry.nightly)) {
    for (const device of interaction.devices) {
      const name = caseName(interaction, device);
      const known = knownFailures.find((entry) => entry.name === name);
      await t.test(name, { timeout: 120000, todo: known && `${known.reason}; Issue Board task ${known.task}` }, async (subtest) => {
        const { context, page, errors } = await openPage(browser, base + interaction.path, { device, storage: interaction.storage });
        try {
          const run = await interaction.prepare(page, device);
          const { frames, blank } = await record(page, run);
          const stats = frameStats(frames);
          subtest.diagnostic(describe(stats));
          assert.deepEqual(errors, []);
          assert.deepEqual(blank, [], 'components that were not ready when they entered the viewport');
          assert.equal(frameProblem(stats), null, describe(stats));
        } finally {
          await context.close();
        }
      });
    }
  }
});
