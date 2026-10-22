import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { formatValue, screens } from './measure-pages.js';

const runs = 5;

export const metrics = [
  { key: 'buildMs', title: 'build', unit: 'ms' },
  { key: 'newMs', title: 'new', unit: 'ms' },
  { key: 'devStartupMs', title: 'startup', unit: 'ms' },
  { key: 'articleUpdateMs', title: 'article edit', unit: 'ms' },
  { key: 'componentUpdateMs', title: 'component edit', unit: 'ms' },
  { key: 'configUpdateMs', title: 'config edit', unit: 'ms' },
];

const exampleBlog = new URL('../examples/blog/', import.meta.url).pathname;
const cli = new URL('../src/cli.js', import.meta.url).pathname;
const BUILD_OUTPUTS = new Set(['dist', '.dist-staging', '.dist-previous', 'node_modules']);
const screen = screens[0];
const articles = ['syntax', 'llm-act-fns', 'matrix-calculus'];
const probe = (text) => `export const layout = { height: 40 };\n\nexport default class MeasureProbe extends HTMLElement {\n  connectedCallback() {\n    this.textContent = '${text}';\n  }\n}\n`;

// The edits write only text of their own, so a change of the example articles does not break the measurement
const edits = (slug) => ({
  articleUpdateMs: { file: `content/posts/${slug}/index.md`, change: (original, run) => `${original}\nARTICLE${run}\n`, text: (run) => `ARTICLE${run}` },
  componentUpdateMs: { file: 'components/measure-probe.js', change: (original, run) => probe(`PROBE${run}`), text: (run) => `PROBE${run}`, frame: 'measure-probe' },
  configUpdateMs: { file: 'bake.config.js', change: (original, run) => original.replace(/title: '/, `title: 'TITLE${run} `), text: (run) => `TITLE${run}` },
});

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
  // why: the first run reads the modules from disk, which later runs and the author's own runs find in the cache
  await measureCommand(['build']);
  const build = [];
  for (let run = 0; run < 3; run += 1) build.push(await measureCommand(['build']));
  const created = [];
  for (let run = 0; run < runs; run += 1) created.push(await measureCommand(['new', `Measured article ${run}`]));
  const startup = [];
  await measureStartup();
  for (let run = 0; run < runs; run += 1) startup.push(await measureStartup());
  return {
    runs,
    metrics: metrics.map((metric) => metric.key),
    measurements: [{ buildMs: median(build), newMs: median(created), devStartupMs: median(startup) }, ...(await measureUpdates())],
  };
}

function copyBlog() {
  const dir = mkdtempSync(join(tmpdir(), 'bake-dev-'));
  cpSync(exampleBlog, dir, { recursive: true, filter: (path) => !BUILD_OUTPUTS.has(basename(path)) });
  writeFileSync(join(dir, 'components/measure-probe.js'), probe('PROBE0'));
  for (const slug of articles) appendFileSync(join(dir, 'content/posts', slug, 'index.md'), '\n:::measure-probe\n:::\n');
  return dir;
}

async function measureCommand(args) {
  const blog = copyBlog();
  try {
    const start = performance.now();
    execFileSync(process.execPath, [cli, ...args], { cwd: blog, stdio: 'ignore' });
    return performance.now() - start;
  } finally {
    rmSync(blog, { recursive: true, force: true });
  }
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

async function measureUpdates() {
  const blog = copyBlog();
  const dev = await startDev(blog);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: screen.width, height: screen.height } });
    const measurements = [];
    for (const slug of articles) {
      const path = /^date: (\d{4}-\d{2})/m.exec(readFileSync(join(blog, 'content/posts', slug, 'index.md'), 'utf8'))[1] + `/${slug}/`;
      await page.goto(new URL(path, dev.url).href);
      await quiet(page);
      const measurement = { page: `/${path}`, width: screen.width };
      for (const [metric, edit] of Object.entries(edits(slug))) measurement[metric] = await measureEdit(page, join(blog, edit.file), edit);
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
  if (edit.frame !== undefined) await showFrame(page, edit.frame);
  const times = [];
  for (let run = 1; run <= runs; run += 1) {
    const start = performance.now();
    writeFileSync(file, edit.change(original, run));
    await untilReloaded(page, visibleText, edit.text(run));
    times.push(performance.now() - start);
    await quiet(page);
  }
  writeFileSync(file, original);
  await untilReloaded(page, (text) => document.body !== null && !document.body.textContent.includes(text), edit.text(runs));
  await quiet(page);
  return median(times);
}

async function showFrame(page, name) {
  const frame = page.locator(`figure.component[data-component="${name}"]`);
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
