import { settle } from '../browser/browser.js';

export const FRAME_BUDGET = 1000 / 60;
export const SLOW_FRAME = FRAME_BUDGET + 1;
export const MAX_SLOW_SHARE = 0.03;
export const MAX_DROPPED_SHARE = 0.03;
export const MAX_FRAME = 2 * FRAME_BUDGET + 1;

export const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

const RECORDER = `(() => {
  const recorder = { frames: [], blank: [], running: false };
  const observer = new IntersectionObserver((entries) => {
    if (!recorder.running) return;
    for (const entry of entries) {
      if (entry.isIntersecting && entry.target.dataset.state !== 'ready') recorder.blank.push(entry.target.dataset.component + ' ' + (entry.target.dataset.state ?? 'not started'));
    }
  });
  recorder.start = () => {
    recorder.frames = [];
    recorder.blank = [];
    recorder.running = true;
    observer.disconnect();
    for (const frame of document.querySelectorAll('figure.component')) observer.observe(frame);
    let last = null;
    const tick = (time) => {
      if (!recorder.running) return;
      if (last !== null) recorder.frames.push(time - last);
      last = time;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  recorder.stop = () => {
    recorder.running = false;
    observer.disconnect();
    return { frames: recorder.frames, blank: recorder.blank };
  };
  window.__bakeFrames = recorder;
})();`;

export async function openPage(browser, url, { device, storage = {} }) {
  const context = await browser.newContext({ ...VIEWPORTS[device], reducedMotion: 'no-preference' });
  await context.addInitScript(RECORDER);
  await context.addInitScript((entries) => {
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
  }, { 'bk-buttons': 'always', ...storage });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const session = await context.newCDPSession(page);
  await session.send('WebAuthn.enable');
  await session.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true },
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.querySelectorAll('figure.component')].every((frame) => frame.dataset.state !== 'loading'));
  await settle(page);
  return { context, page, errors };
}

export async function record(page, action) {
  await page.evaluate(() => window.__bakeFrames.start());
  await action();
  return page.evaluate(() => window.__bakeFrames.stop());
}

export function frameStats(frames) {
  const sorted = [...frames].sort((a, b) => a - b);
  const slow = sorted.filter((frame) => frame > SLOW_FRAME).length;
  const dropped = sorted.reduce((sum, frame) => sum + Math.max(0, Math.round(frame / FRAME_BUDGET) - 1), 0);
  return {
    dropped,
    droppedShare: dropped / (sorted.length + dropped),
    frames: sorted.length,
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    longest: sorted.at(-1),
    slowShare: slow / sorted.length,
  };
}

export function frameProblem(stats) {
  if (stats.frames < 20) return `only ${stats.frames} frames were drawn`;
  const problems = [];
  if (stats.slowShare > MAX_SLOW_SHARE) problems.push(`${(stats.slowShare * 100).toFixed(1)}% of the frames took longer than ${SLOW_FRAME.toFixed(1)} ms`);
  if (stats.droppedShare > MAX_DROPPED_SHARE) problems.push(`${stats.dropped} frames were dropped, ${(stats.droppedShare * 100).toFixed(1)}% of the frames the display showed`);
  if (stats.longest > MAX_FRAME) problems.push(`the longest frame took ${stats.longest.toFixed(1)} ms`);
  return problems.length === 0 ? null : problems.join(' and ');
}

export function describe(stats) {
  return `${stats.frames} frames, median ${stats.median.toFixed(1)} ms, 95th percentile ${stats.p95.toFixed(1)} ms, longest ${stats.longest.toFixed(1)} ms, ${(stats.slowShare * 100).toFixed(1)}% slower than ${SLOW_FRAME.toFixed(1)} ms, ${stats.dropped} dropped frames (${(stats.droppedShare * 100).toFixed(1)}%)`;
}

export async function paced(steps, duration, step) {
  const start = Date.now();
  for (let index = 0; index < steps; index += 1) {
    await step(index);
    const wait = start + ((index + 1) * duration) / steps - Date.now();
    if (wait > 0) await new Promise((done) => setTimeout(done, wait));
  }
}
