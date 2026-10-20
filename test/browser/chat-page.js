import { launchBrowser, nextFrame } from './browser.js';

export const API_KEY = 'sk-test-0123456789abcdef';
export const PETS = 'https://pets.example';
export const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST' };

export function events(chunks, finish = 'stop') {
  const lines = chunks.map((delta, index) => ({ choices: [{ index: 0, delta, finish_reason: index === chunks.length - 1 ? finish : null }] }));
  return `${lines.map((line) => `data: ${JSON.stringify(line)}\n\n`).join('')}data: [DONE]\n\n`;
}

export function text(content, size = 6) {
  const chunks = [{ role: 'assistant', content: '' }];
  for (let index = 0; index < content.length; index += size) chunks.push({ content: content.slice(index, index + size) });
  return events(chunks);
}

export async function openBrowser(t, base, { prf = true, contextOptions = {} } = {}) {
  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'], ...contextOptions });
  const api = { requests: [], answers: [], models: { status: 200, body: '{"object":"list","data":[]}' }, pets: {}, petRequests: [] };
  await context.route(
    (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === PETS) {
        api.petRequests.push({ path: url.pathname, headers: request.headers() });
        const file = api.pets[url.pathname];
        if (file === undefined) return route.fulfill({ status: 404, headers: CORS });
        if (file.hang) return new Promise(() => {});
        return route.fulfill({ status: 200, headers: CORS, body: file });
      }
      if (url.origin !== 'https://api.deepseek.com') return route.abort();
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      api.requests.push({ path: url.pathname, headers: request.headers(), body: request.postDataJSON() });
      if (url.pathname === '/models') return route.fulfill({ status: api.models.status, headers: { ...CORS, 'content-type': 'application/json' }, body: api.models.body });
      const next = api.answers.shift() ?? { status: 500, body: '{"error":{"message":"no answer prepared"}}' };
      if (next.offline) return route.abort('internetdisconnected');
      return route.fulfill({ status: next.status ?? 200, headers: { ...CORS, 'content-type': next.status === undefined ? 'text/event-stream' : 'application/json' }, body: next.body });
    },
  );
  await context.addInitScript(() => {
    window.bakeTest = { signals: [], hold: false, held: [] };
    const signal = PublicKeyCredential.signalUnknownCredential;
    PublicKeyCredential.signalUnknownCredential = (options) => {
      window.bakeTest.signals.push(options.credentialId);
      return signal.call(PublicKeyCredential, options);
    };
    const fetch = window.fetch;
    window.fetch = (input, init = {}) => {
      if (!window.bakeTest.hold || !String(input).endsWith('/chat/completions')) return fetch(input, init);
      window.bakeTest.held.push(JSON.parse(init.body));
      const first = { choices: [{ index: 0, delta: { content: '前半句' }, finish_reason: null }] };
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(first)}\n\n`));
          init.signal.addEventListener('abort', () => controller.error(init.signal.reason));
        },
      });
      return Promise.resolve(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
    };
  });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(error.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: prf, automaticPresenceSimulation: true },
  });
  const passkeys = async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials.map((credential) => credential.credentialId.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''));
  return { context, page, api, problems, passkeys };
}

export async function storage(page) {
  return page.evaluate(() => ({
    local: Object.fromEntries(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)])),
    session: Object.fromEntries(Object.keys(sessionStorage).map((key) => [key, sessionStorage.getItem(key)])),
    cookies: document.cookie,
  }));
}

export const QUESTION = '.bk-chat-composer input[name="question"]';
export const KEY = '.bk-chat-composer input[name="key"]';

export async function setUpKey(page, key = API_KEY) {
  if ((await page.locator('.bk-chat-launcher').getAttribute('aria-expanded')) !== 'true') await page.locator('.bk-chat-launcher').click();
  await page.locator(KEY).fill(key);
  await page.locator(KEY).press('Enter');
  await page.locator(QUESTION).waitFor();
}

export async function ask(page, question) {
  await page.locator(QUESTION).fill(question);
  await page.locator(QUESTION).press('Enter');
}

export async function scrollPage(page, delta) {
  for (let step = 0; step < 5; step += 1) {
    await page.evaluate((amount) => window.scrollBy(0, amount), delta / 5);
    await nextFrame(page);
  }
}

const PET_ROWS = {
  idle: [0, 6, 'still'],
  greet: [3, 4, 'once'],
  open: [0, 6, 'once'],
  unlocking: [6, 6, 'loop'],
  answering: [7, 6, 'loop'],
  reading: [8, 6, 'loop'],
  answered: [4, 5, 'once'],
  failed: [5, 8, 'hold'],
};

export function petEntry(state, { reduced = false } = {}) {
  const [row, frames, play] = PET_ROWS[state];
  if (reduced || play === 'still') return { row, frames: null, play: 'still' };
  return { row, frames, play: play === 'loop' ? 'loop' : 'once' };
}

export async function watchPet(page) {
  await page.locator('.bk-chat-launcher .bk-chat-pet').waitFor();
  await page.evaluate(() => {
    const pet = document.querySelector('[data-bake-chat]').shadowRoot.querySelector('.bk-chat-pet');
    const sheet = pet.querySelector('.bk-chat-pet-sheet');
    const shown = () => {
      const box = pet.getBoundingClientRect();
      const style = getComputedStyle(sheet);
      const [animation] = sheet.getAnimations();
      const moves = animation !== undefined && animation.effect.getKeyframes().some((keyframe) => keyframe.transform !== undefined && keyframe.transform !== 'none');
      const row = Math.round((box.top - sheet.getBoundingClientRect().top) / box.height);
      if (!moves) return { row, frames: null, play: 'still' };
      return { row, frames: Number(/steps\((\d+)/.exec(style.animationTimingFunction)[1]), play: style.animationIterationCount === 'infinite' ? 'loop' : 'once' };
    };
    window.bakeTest.pet = [];
    let last = '';
    const record = () => {
      const entry = shown();
      if (JSON.stringify(entry) !== last) window.bakeTest.pet.push(entry);
      last = JSON.stringify(entry);
    };
    const watch = () => {
      record();
      requestAnimationFrame(watch);
    };
    watch();
    // why: a state can last shorter than a frame under load, so every change of the pet is recorded as well
    new MutationObserver(record).observe(pet, { attributes: true });
  });
}

export async function petSeen(page, state, options) {
  const entry = petEntry(state, options);
  await page.waitForFunction((entry) => window.bakeTest.pet.some((seen) => JSON.stringify(seen) === JSON.stringify(entry)), entry);
}

export function shadow(page, script, argument) {
  return page.evaluate(({ script, argument }) => new Function('root', 'argument', script)(document.querySelector('[data-bake-chat]').shadowRoot, argument), { script, argument });
}

export async function openSettings(page) {
  if ((await page.locator('.bk-chat-launcher').getAttribute('aria-expanded')) !== 'true') await page.locator('.bk-chat-launcher').click();
  await page.locator('.bk-chat-composer button[aria-label="对话设置"]').click();
  await page.locator('.bk-chat-menu').waitFor();
}

export function backdropRoots(chat) {
  const roots = [];
  for (let node = chat; node !== null; node = node.parentNode instanceof ShadowRoot ? node.parentNode.host : node.parentElement) {
    const style = getComputedStyle(node);
    const reasons = [
      Number(style.opacity) < 1 && 'opacity',
      style.filter !== 'none' && 'filter',
      style.maskImage !== 'none' && 'mask',
      style.clipPath !== 'none' && 'clip-path',
      style.mixBlendMode !== 'normal' && 'mix-blend-mode',
      style.backdropFilter !== 'none' && 'backdrop-filter',
      /opacity|filter|mask|clip-path|mix-blend-mode/.test(style.willChange) && 'will-change',
    ].filter(Boolean);
    if (reasons.length > 0) roots.push(`${node.localName}.${node.classList[0] ?? ''} ${reasons.join(' ')}`);
  }
  return roots;
}
