import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { formatValue, screens } from './measure-pages.js';

const runs = 5;

export const metrics = [
  { key: 'devStartupMs', title: 'startup', unit: 'ms' },
  { key: 'articleUpdateMs', title: 'article edit', unit: 'ms' },
  { key: 'componentUpdateMs', title: 'component edit', unit: 'ms' },
  { key: 'configUpdateMs', title: 'config edit', unit: 'ms' },
];

const exampleBlog = new URL('../examples/blog/', import.meta.url).pathname;
const cli = new URL('../src/cli.js', import.meta.url).pathname;
const BUILD_OUTPUTS = new Set(['dist', '.dist-staging', '.dist-previous', 'node_modules']);
const screen = screens[0];

const configEdit = { file: 'bake.config.js', anchor: "title: 'Bake Example'", change: (run) => `title: 'Bake Example MEASURE${run}'`, text: (run) => `Bake Example MEASURE${run}` };

const pages = [
  {
    path: '/2026-10/syntax/',
    articleUpdateMs: articleEdit('syntax', '这篇文章列出 Bake 的全部写法。'),
    componentUpdateMs: labelEdit('act-fn-plot', '近似'),
    configUpdateMs: configEdit,
  },
  {
    path: '/2026-09/llm-act-fns/',
    articleUpdateMs: articleEdit('llm-act-fns', '一个 decoder block 由注意力和前馈网络（FFN）两部分组成。'),
    componentUpdateMs: labelEdit('llm-act-plot', '横轴范围 ±', '"zoom":true'),
    configUpdateMs: configEdit,
  },
  {
    path: '/2026-09/matrix-calculus/',
    articleUpdateMs: articleEdit('matrix-calculus', '深度学习里的反向传播，本质上是在回答一个问题：'),
    componentUpdateMs: componentEdit('matrix-loss-logits', 'reset'),
    configUpdateMs: configEdit,
  },
];

const usage = 'Usage: node scripts/measure-dev.js [--out report.json]';

if (import.meta.main) await main(process.argv.slice(2));

async function main(args) {
  if (!(args.length === 0 || (args.length === 2 && args[0] === '--out'))) {
    console.error(usage);
    process.exit(2);
  }
  const report = await measureDev();
  for (const measurement of report.measurements) console.log(formatMeasurement(measurement));
  if (args[1] !== undefined) writeFileSync(args[1], `${JSON.stringify(report, null, 2)}\n`);
}

async function measureDev() {
  const startup = [];
  // why: the first start reads the modules from disk, which later starts and the author's own starts find in the cache
  await measureStartup();
  for (let run = 0; run < runs; run += 1) startup.push(await measureStartup());
  return {
    runs,
    metrics: metrics.map((metric) => metric.key),
    measurements: [{ devStartupMs: median(startup) }, ...(await measureUpdates())],
  };
}

function copyBlog() {
  const dir = mkdtempSync(join(tmpdir(), 'bake-dev-'));
  cpSync(exampleBlog, dir, { recursive: true, filter: (path) => !BUILD_OUTPUTS.has(basename(path)) });
  return dir;
}

async function startDev(blog) {
  const child = spawn(process.execPath, [cli, 'dev', '--port', '0', '--no-open'], { cwd: blog, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stderr.on('data', (chunk) => (output += chunk));
  const url = await new Promise((done, fail) => {
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const address = output.match(/http:\/\/[^\s/]+\//);
      if (address) done(address[0]);
    });
    child.once('exit', (code) => fail(new Error(`bake dev exited with ${code}:\n${output}`)));
  });
  for (;;) {
    const status = await fetch(url).then(async (response) => (await response.text(), response.status), () => null);
    if (status === 200) break;
    await sleep(5);
  }
  return { child, url };
}

async function stopDev({ child }) {
  if (child.exitCode !== null) return;
  const exited = new Promise((done) => child.once('exit', done));
  child.kill('SIGINT');
  await exited;
}

async function measureStartup() {
  const blog = copyBlog();
  try {
    const start = performance.now();
    const dev = await startDev(blog);
    const time = performance.now() - start;
    await stopDev(dev);
    return time;
  } finally {
    rmSync(blog, { recursive: true, force: true });
  }
}

function articleEdit(slug, anchor) {
  return { file: `content/posts/${slug}/index.md`, anchor, change: (run) => `${anchor}MEASURE${run}`, text: (run) => `MEASURE${run}` };
}

function componentEdit(name, label, frameParams = '') {
  return {
    file: `components/${name}.jsx`,
    anchor: `>${label}<`,
    change: (run) => `>${label}MEASURE${run}<`,
    text: (run) => `${label}MEASURE${run}`,
    frame: { name, frameParams },
  };
}

function labelEdit(name, label, frameParams) {
  return { ...componentEdit(name, label, frameParams), anchor: `label="${label}"`, change: (run) => `label="${label}MEASURE${run}"` };
}

async function measureUpdates() {
  const blog = copyBlog();
  const dev = await startDev(blog);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: screen.width, height: screen.height } });
    const measurements = [];
    for (const { path, ...edits } of pages) {
      await page.goto(new URL(path, dev.url).href);
      await quiet(page);
      const measurement = { page: path, width: screen.width };
      for (const [metric, edit] of Object.entries(edits)) measurement[metric] = await measureEdit(page, join(blog, edit.file), edit);
      measurements.push(measurement);
    }
    return measurements;
  } finally {
    await browser.close();
    await stopDev(dev);
    rmSync(blog, { recursive: true, force: true });
  }
}

async function measureEdit(page, file, edit) {
  const original = readFileSync(file, 'utf8');
  if (original.split(edit.anchor).length !== 2) throw new Error(`${file} does not contain ${edit.anchor} exactly once`);
  if (edit.frame !== undefined) await showFrame(page, edit.frame);
  const times = [];
  for (let run = 1; run <= runs; run += 1) {
    const start = performance.now();
    writeFileSync(file, original.replace(edit.anchor, edit.change(run)));
    await untilReloaded(page, visibleText, edit.text(run));
    times.push(performance.now() - start);
    await quiet(page);
  }
  writeFileSync(file, original);
  await untilReloaded(page, (text) => document.body !== null && !document.body.textContent.includes(text), edit.text(runs));
  await quiet(page);
  return median(times);
}

async function showFrame(page, { name, frameParams }) {
  const frames = page.locator(`figure.component[data-component="${name}"]`);
  const index = await frames.evaluateAll((elements, frameParams) => elements.findIndex((element) => element.dataset.params.includes(frameParams)), frameParams);
  if (index < 0) throw new Error(`${name} with ${frameParams} is not on the page`);
  const frame = frames.nth(index);
  await frame.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await page.waitForFunction((element) => element.dataset.state === 'ready', await frame.elementHandle());
  await quiet(page);
}

function visibleText(text) {
  if (document.body === null) return false;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.data.includes(text) && node.parentElement.checkVisibility()) return true;
  }
  return false;
}

async function untilReloaded(page, condition, argument) {
  for (;;) {
    try {
      await page.waitForFunction(condition, argument, { polling: 'raf', timeout: 60000 });
      return;
    } catch (error) {
      // why: a change that bake dev cannot apply in place reloads the page, which destroys the context the condition runs in
      if (!/context|navigat|destroyed|detached/i.test(error.message)) throw error;
    }
  }
}

async function quiet(page) {
  await page.waitForLoadState('load');
  await page.evaluate(() => new Promise((done) => requestIdleCallback(done, { timeout: 2000 })));
  await sleep(1500);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
}

function formatMeasurement(measurement) {
  const values = metrics.filter((metric) => measurement[metric.key] !== undefined).map((metric) => `${metric.title} ${formatValue(measurement[metric.key], metric.unit)}`);
  return [measurement.page ?? 'bake dev', ...values].join('  ');
}
