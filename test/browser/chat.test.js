import assert from 'node:assert/strict';
import { cpSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { bake, createBlog } from '../blog.js';
import { isSelectionChunk } from './selection-module.js';
import { serve } from './server.js';

const exampleBlog = join(import.meta.dirname, '../../examples/blog');
const syntaxSource = readFileSync(join(exampleBlog, 'content/posts/syntax/index.md'), 'utf8');
const jacobianSource = readFileSync(join(exampleBlog, 'content/posts/jacobian/index.md'), 'utf8');
const API_KEY = 'sk-test-0123456789abcdef';
const PETS = 'https://pets.example';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST' };

function events(chunks, finish = 'stop') {
  const lines = chunks.map((delta, index) => ({ choices: [{ index: 0, delta, finish_reason: index === chunks.length - 1 ? finish : null }] }));
  return `${lines.map((line) => `data: ${JSON.stringify(line)}\n\n`).join('')}data: [DONE]\n\n`;
}

function text(content, size = 6) {
  const chunks = [{ role: 'assistant', content: '' }];
  for (let index = 0; index < content.length; index += size) chunks.push({ content: content.slice(index, index + size) });
  return events(chunks);
}

async function buildExample(t) {
  const dir = createBlog(t, {});
  cpSync(exampleBlog, dir, { recursive: true, filter: (path) => path !== join(exampleBlog, 'dist') });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  return (await serve(t, join(dir, 'dist'))).replace('127.0.0.1', 'localhost');
}

async function openBrowser(t, base, { prf = true, contextOptions = {} } = {}) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
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
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: prf, automaticPresenceSimulation: true },
  });
  return { context, page, api, problems };
}

async function storage(page) {
  return page.evaluate(() => ({
    local: Object.fromEntries(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)])),
    session: Object.fromEntries(Object.keys(sessionStorage).map((key) => [key, sessionStorage.getItem(key)])),
    cookies: document.cookie,
  }));
}

const QUESTION = '.bk-chat-composer input[name="question"]';
const KEY = '.bk-chat-composer input[name="key"]';

async function setUpKey(page, key = API_KEY) {
  if ((await page.locator('.bk-chat-launcher').getAttribute('aria-expanded')) !== 'true') await page.locator('.bk-chat-launcher').click();
  await page.locator(KEY).fill(key);
  await page.locator(KEY).press('Enter');
  await page.locator(QUESTION).waitFor();
}

async function ask(page, question) {
  await page.locator(QUESTION).fill(question);
  await page.locator(QUESTION).press('Enter');
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

function petEntry(state, { reduced = false } = {}) {
  const [row, frames, play] = PET_ROWS[state];
  if (reduced) return { state, row, frames, animation: 'still', iterations: '1' };
  return { state, row, frames, animation: { still: 'none', loop: 'loop', once: 'once', hold: 'once' }[play], iterations: play === 'loop' ? 'infinite' : '1' };
}

async function watchPet(page) {
  await page.locator('.bk-chat-launcher .bk-chat-pet').waitFor();
  await page.evaluate(() => {
    const pet = document.querySelector('[data-bake-chat]').shadowRoot.querySelector('.bk-chat-pet');
    const sheet = pet.querySelector('.bk-chat-pet-sheet');
    const record = () => {
      const box = pet.getBoundingClientRect();
      const style = getComputedStyle(sheet);
      window.bakeTest.pet.push({
        state: pet.dataset.state,
        row: Math.round((box.top - sheet.getBoundingClientRect().top) / box.height),
        frames: Number(getComputedStyle(pet).getPropertyValue('--bk-chat-pet-frames')),
        animation: style.animationName.replace(/^bk-chat-pet-/, '').replace(/-[01]$/, ''),
        iterations: style.animationIterationCount,
      });
    };
    window.bakeTest.pet = [];
    record();
    new MutationObserver(record).observe(pet, { attributes: true, attributeFilter: ['data-play'] });
  });
}

async function petSeen(page, state) {
  await page.waitForFunction((name) => window.bakeTest.pet.some((entry) => entry.state === name), state);
  return page.evaluate((name) => window.bakeTest.pet.find((entry) => entry.state === name), state);
}

function lastPet(page) {
  return page.evaluate(() => window.bakeTest.pet.at(-1).state);
}

function mainThreadTasks(trace) {
  const events = trace.traceEvents;
  const main = events.find((event) => event.name === 'thread_name' && event.args.name === 'CrRendererMain');
  return events
    .filter((event) => event.pid === main.pid && event.tid === main.tid && event.name === 'RunTask' && event.ph === 'X')
    .map((event) => Math.round(event.dur / 100) / 10)
    .sort((a, b) => b - a);
}

function shadow(page, script, argument) {
  return page.evaluate(({ script, argument }) => new Function('root', 'argument', script)(document.querySelector('[data-bake-chat]').shadowRoot, argument), { script, argument });
}

async function sheetTransforms(page) {
  const seen = [];
  for (let step = 0; step < 6; step += 1) {
    seen.push(await shadow(page, "return getComputedStyle(root.querySelector('.bk-chat-pet-sheet')).transform;"));
    await page.waitForTimeout(90);
  }
  return seen;
}

function petSheet(width, height, format = 'webp') {
  return sharp({ create: { width, height, channels: 4, background: { r: 40, g: 120, b: 200, alpha: 1 } } })
    [format]()
    .toBuffer();
}

async function openSettings(page) {
  if ((await page.locator('.bk-chat-launcher').getAttribute('aria-expanded')) !== 'true') await page.locator('.bk-chat-launcher').click();
  await page.locator('.bk-chat-composer button[aria-label="对话设置"]').click();
  await page.locator('.bk-chat-menu').waitFor();
}

test('the AI chat on published pages', async (t) => {
  const base = await buildExample(t);

  await t.test('the key is saved with a passkey, the browser stores only ciphertext, and the answer about the article streams with formulas and links', async (t) => {
    const { page, api, problems } = await openBrowser(t, base);
    await page.goto(`${base}/2026-10/syntax/`);
    await page.locator('.bk-chat-launcher').click();
    const setup = page.locator('.bk-chat-note').first();
    await setup.filter({ hasText: 'DeepSeek API key' }).waitFor();
    assert.equal(await setup.locator('a').getAttribute('href'), 'https://platform.deepseek.com/api_keys');
    assert.equal(await page.locator(KEY).getAttribute('type'), 'password');
    await setUpKey(page);
    assert.deepEqual(
      api.requests.map((request) => [request.path, request.headers.authorization]),
      [['/models', `Bearer ${API_KEY}`]],
    );
    await page.locator('.bk-chat-note').filter({ hasText: 'key 已保存' }).waitFor();
    const stored = await storage(page);
    assert.doesNotMatch(JSON.stringify(stored), new RegExp(API_KEY));
    assert.deepEqual(Object.keys(JSON.parse(stored.local['bk-chat-key'])).sort(), ['credential', 'data', 'iv', 'salt']);
    assert.equal(await page.locator(QUESTION).getAttribute('placeholder'), '问这篇文章，打 @ 选范围…');

    api.answers.push({ body: text('标题见 [标题](#headings)。公式 $\\R^2$ 和\n\n$$\\frac{a}{b}$$\n\n结束。') });
    await ask(page, '这篇文章讲什么？');
    await page.locator('.bk-chat-reply[data-done] .bk-chat-answer').filter({ hasText: '结束。' }).waitFor();
    await page.locator('.bk-chat-answer .bk-chat-math[data-state="ready"] svg').nth(1).waitFor();
    assert.equal(await page.locator('.bk-chat-answer a').getAttribute('href'), '#headings');
    assert.equal(await page.locator('.bk-chat-user').textContent(), '这篇文章讲什么？');
    const request = api.requests.at(-1);
    assert.equal(request.path, '/chat/completions');
    assert.equal(request.headers.authorization, `Bearer ${API_KEY}`);
    assert.equal(request.body.model, 'deepseek-flash');
    assert.equal(request.body.stream, true);
    assert.deepEqual(
      request.body.tools.map((tool) => tool.function.name),
      ['read_article'],
    );
    assert.equal(request.body.messages[0].role, 'system');
    assert.ok(request.body.messages[0].content.includes(`<article>\n${syntaxSource}\n</article>`), 'the system message holds the article source');
    assert.match(request.body.messages[0].content, /\n- #headings 标题与锚点\n {2}- #third-level 三级标题\n/);
    assert.match(request.body.messages[0].content, /"address":"\/2026-10\/jacobian\/","title":"雅可比矩阵"/);
    assert.deepEqual(request.body.messages.slice(1), [{ role: 'user', content: '这篇文章讲什么？' }]);
    assert.deepEqual(problems, []);
  });

  await t.test('a reload unlocks the key with the passkey once when the chat opens and keeps the conversation going', async (t) => {
    const { page, api } = await openBrowser(t, base);
    await page.goto(`${base}/2026-10/syntax/`);
    await setUpKey(page);
    await page.reload();
    await watchPet(page);
    await page.locator('.bk-chat-launcher').click();
    await page.locator('.bk-chat-note').filter({ hasText: '已解锁' }).waitFor();
    await page.locator(QUESTION).waitFor();
    assert.deepEqual(await petSeen(page, 'unlocking'), petEntry('unlocking'));
    api.answers.push({ body: text('好的。') });
    await ask(page, '再说一次');
    await page.locator('.bk-chat-reply[data-done]').waitFor();
    assert.equal(api.requests.at(-1).headers.authorization, `Bearer ${API_KEY}`);
    assert.equal(await page.locator('.bk-chat-note').filter({ hasText: '用通行密钥解锁' }).count(), 1);
  });

  await t.test('chatting about the whole blog reads articles with a tool and links into them', async (t) => {
    const { page, api } = await openBrowser(t, base);
    const fetched = [];
    page.on('request', (request) => fetched.push(new URL(request.url()).pathname));
    await page.goto(`${base}/`);
    await setUpKey(page);
    assert.equal(await page.locator(QUESTION).getAttribute('placeholder'), '问这个博客，打 @ 选范围…');
    const call = { index: 0, id: 'call_1', type: 'function', function: { name: 'read_article', arguments: '' } };
    api.answers.push({
      body: events(
        [
          { role: 'assistant', content: '' },
          { tool_calls: [call] },
          { tool_calls: [{ index: 0, function: { arguments: '{"address":' } }] },
          { tool_calls: [{ index: 0, function: { arguments: '"/2026-10/jacobian/"}' } }] },
        ],
        'tool_calls',
      ),
    });
    api.answers.push({ body: text('见 [雅可比矩阵](/2026-10/jacobian/#定义)。') });
    await ask(page, '雅可比矩阵是什么？');
    await page.locator('.bk-chat-reply[data-done] .bk-chat-answer a').waitFor();
    assert.equal(await page.locator('.bk-chat-answer a').getAttribute('href'), `${base}/2026-10/jacobian/#%E5%AE%9A%E4%B9%89`);
    assert.equal(await page.locator('.bk-chat-read').textContent(), '读了《雅可比矩阵》');
    assert.ok(fetched.includes('/_bake/articles.json'));
    assert.ok(fetched.includes('/2026-10/jacobian/index.md'));
    const [first, second] = api.requests.filter((request) => request.path === '/chat/completions');
    assert.deepEqual(
      first.body.tools.map((tool) => tool.function.name),
      ['read_article'],
    );
    assert.match(first.body.messages[0].content, /"address":"\/2026-10\/jacobian\/","title":"雅可比矩阵"/);
    assert.doesNotMatch(first.body.messages[0].content, /<article>/);
    const tool = second.body.messages.at(-1);
    assert.deepEqual(tool, { role: 'tool', tool_call_id: 'call_1', content: jacobianSource });
    assert.deepEqual(second.body.messages.at(-2).tool_calls, [{ id: 'call_1', type: 'function', function: { name: 'read_article', arguments: '{"address":"/2026-10/jacobian/"}' } }]);
  });

  await t.test('a selected passage can be asked about directly', async (t) => {
    const { page, api } = await openBrowser(t, base);
    await page.goto(`${base}/2026-10/syntax/`);
    await setUpKey(page);
    await page.keyboard.press('Escape');
    await page.locator('.bk-chat:not([data-open])').waitFor({ state: 'attached' });
    await page.evaluate(() => {
      const paragraph = document.querySelector('.bk-article > .bk-block[data-type="paragraph"] p');
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    await page.locator('.bk-chat-ask').click();
    await page.locator('.bk-chat[data-open]').waitFor();
    const quote = await page.locator('.bk-chat-composer .bk-chat-quote').getAttribute('title');
    assert.ok(quote.startsWith('这篇文章列出 Bake 的全部写法'), quote);
    api.answers.push({ body: text('这一段介绍了文章。') });
    await ask(page, '这段是什么意思？');
    await page.locator('.bk-chat-reply[data-done]').waitFor();
    assert.equal(api.requests.at(-1).body.messages.at(-1).content, `> ${quote}\n\n这段是什么意思？`);
    assert.equal(await page.locator('.bk-chat-user blockquote').textContent(), quote);
    assert.equal(await page.locator('.bk-chat-composer .bk-chat-quote').count(), 0);
  });

  await t.test('when the module that writes a selection cannot be loaded, asking about a selected passage opens the chat without a quote', async (t) => {
    const { page, problems } = await openBrowser(t, base);
    await page.route((url) => isSelectionChunk(url.href), (route) => route.abort());
    await page.goto(`${base}/2026-10/syntax/`);
    await setUpKey(page);
    await page.keyboard.press('Escape');
    await page.locator('.bk-chat:not([data-open])').waitFor({ state: 'attached' });
    await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('.bk-article > .bk-block[data-type="paragraph"] p'));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    await page.locator('.bk-chat-ask').click();
    await page.locator('.bk-chat[data-open]').waitFor({ timeout: 5000 });
    assert.equal(await page.locator('.bk-chat-composer .bk-chat-quote').count(), 0);
    assert.deepEqual(problems, []);
  });

  await t.test('DeepSeek errors are explained with a retry, and a cleared key leaves nothing in storage', async (t) => {
    const { page, api } = await openBrowser(t, base);
    await page.goto(`${base}/2026-10/syntax/`);
    await setUpKey(page);
    api.answers.push({ status: 402, body: '{"error":{"message":"Insufficient Balance"}}' });
    await ask(page, '你好');
    await page.locator('.bk-chat-reply .bk-chat-problem').filter({ hasText: '余额不足' }).waitFor();
    api.answers.push({ body: events([{ reasoning_content: '先想一想。' }, { content: '你好！' }]) });
    await page.locator('.bk-chat-reply .bk-chat-problem button').click();
    await page.locator('.bk-chat-reply[data-done] .bk-chat-answer').filter({ hasText: '你好！' }).waitFor();
    assert.equal(await page.locator('.bk-chat-reply').count(), 1);
    const reasoning = page.locator('.bk-chat-reasoning');
    assert.match(await reasoning.evaluate((element) => getComputedStyle(element, '::details-content').transitionProperty), /block-size/);
    await reasoning.locator('summary').click();
    await page.waitForFunction(() => {
      const details = document.querySelector('[data-bake-chat]').shadowRoot.querySelector('.bk-chat-reasoning');
      return getComputedStyle(details, '::details-content').blockSize !== '0px';
    });
    assert.equal(await reasoning.locator('p').textContent(), '先想一想。');

    api.answers.push({ offline: true });
    await ask(page, '还在吗？');
    await page.locator('.bk-chat-reply .bk-chat-problem').filter({ hasText: '连不上 DeepSeek' }).waitFor();
    api.answers.push({ status: 400, body: '{"error":{"message":"This model\'s maximum context length is 131072 tokens. However, you requested 140000 tokens."}}' });
    await page.locator('.bk-chat-reply .bk-chat-problem button').click();
    await page.locator('.bk-chat-reply .bk-chat-problem').filter({ hasText: '新对话' }).waitFor();
    await openSettings(page);
    await page.locator('.bk-chat-menu-item[data-action="clear-key"]').click();
    await page.locator(KEY).waitFor();
    await page.locator('.bk-chat-note').filter({ hasText: 'key 已清除' }).waitFor();
    assert.equal((await storage(page)).local['bk-chat-key'], undefined);
  });

  await t.test('stopping an answer keeps the text written so far and sends it with the next question, and screen readers hear a reply only when it is done, also a reply equal to the one before', async (t) => {
    const { page, api } = await openBrowser(t, base);
    await page.goto(`${base}/2026-10/syntax/`);
    await setUpKey(page);
    await page.evaluate(() => (window.bakeTest.hold = true));
    await ask(page, '慢慢说');
    await page.locator('.bk-chat-answer').filter({ hasText: '前半句' }).waitFor();
    const status = page.locator('.bk-chat-status[role="status"]');
    assert.equal(await page.locator('[aria-live]').count(), 0);
    assert.doesNotMatch(await status.textContent(), /前半句/);
    const stop = page.locator('.bk-chat-send[data-action="stop"]');
    await stop.click();
    await page.locator('.bk-chat-reply[data-done]').waitFor();
    assert.equal(await stop.count(), 0);
    assert.equal(await page.locator('.bk-chat-reply .bk-chat-problem').count(), 0);
    assert.equal(await page.locator('.bk-chat-answer').textContent(), '前半句');
    await page.evaluate(() => (window.bakeTest.hold = false));
    api.answers.push({ body: text('继续。') });
    await ask(page, '接着说');
    await page.locator('.bk-chat-reply[data-done] .bk-chat-answer').filter({ hasText: '继续。' }).waitFor();
    assert.equal(await status.textContent(), '继续。');
    assert.deepEqual(
      api.requests
        .at(-1)
        .body.messages.slice(1)
        .map(({ role, content }) => [role, content]),
      [
        ['user', '慢慢说'],
        ['assistant', '前半句'],
        ['user', '接着说'],
      ],
    );
    const announced = await status.locator('span').elementHandle();
    api.answers.push({ body: text('继续。') });
    await ask(page, '再说一遍');
    await page.locator('.bk-chat-reply[data-done] .bk-chat-answer').nth(2).waitFor();
    assert.equal(await status.textContent(), '继续。');
    assert.equal(await announced.evaluate((element) => element.isConnected), false);
  });

  await t.test('a new chat started while an answer streams drops that answer from the bubbles and from the next request', async (t) => {
    const { page, api } = await openBrowser(t, base);
    await page.goto(`${base}/2026-10/syntax/`);
    await setUpKey(page);
    await page.evaluate(() => (window.bakeTest.hold = true));
    await ask(page, '旧问题');
    await page.locator('.bk-chat-answer').filter({ hasText: '前半句' }).waitFor();
    await openSettings(page);
    await page.locator('.bk-chat-menu-item', { hasText: '新对话' }).click();
    await page.locator('.bk-chat-send[data-action="stop"]').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.bk-chat-reply, .bk-chat-user').count(), 0);
    await page.evaluate(() => (window.bakeTest.hold = false));
    api.answers.push({ body: text('新回答。') });
    await ask(page, '新问题');
    await page.locator('.bk-chat-reply[data-done] .bk-chat-answer').filter({ hasText: '新回答。' }).waitFor();
    assert.equal(await page.locator('.bk-chat-reply').count(), 1);
    assert.deepEqual(api.requests.at(-1).body.messages.slice(1), [{ role: 'user', content: '新问题' }]);
  });

  await t.test('only the last failed reply offers a retry, and never while another answer streams', async (t) => {
    const { page, api } = await openBrowser(t, base);
    await page.goto(`${base}/2026-10/syntax/`);
    await setUpKey(page);
    api.answers.push({ status: 402, body: '{"error":{"message":"Insufficient Balance"}}' });
    await ask(page, '第一问');
    const first = page.locator('.bk-chat-reply').nth(0);
    await first.locator('.bk-chat-problem').filter({ hasText: '余额不足' }).waitFor();
    assert.equal(await first.locator('.bk-chat-problem button').count(), 1);
    await page.evaluate(() => (window.bakeTest.hold = true));
    await ask(page, '第二问');
    const second = page.locator('.bk-chat-reply').nth(1);
    await second.locator('.bk-chat-answer').filter({ hasText: '前半句' }).waitFor();
    assert.equal(await first.locator('.bk-chat-problem button').count(), 0);
    await page.locator('.bk-chat-send[data-action="stop"]').click();
    await page.locator('.bk-chat-reply[data-done]').nth(1).waitFor();
    assert.equal(await first.locator('.bk-chat-problem').count(), 1);
    assert.equal(await first.locator('.bk-chat-problem button').count(), 0);
    assert.equal(await second.locator('.bk-chat-answer').textContent(), '前半句');
    await page.evaluate(() => (window.bakeTest.hold = false));
    api.answers.push({ body: text('第三答。') });
    await ask(page, '第三问');
    await page.locator('.bk-chat-reply[data-done] .bk-chat-answer').filter({ hasText: '第三答。' }).waitFor();
    assert.equal(await page.locator('.bk-chat-reply').count(), 3);
    assert.deepEqual(
      api.requests
        .at(-1)
        .body.messages.slice(1)
        .map(({ role, content }) => [role, content]),
      [
        ['user', '第二问'],
        ['assistant', '前半句'],
        ['user', '第三问'],
      ],
    );
  });

  await t.test('changing the key replaces the stored key and asks the browser to forget the old passkey', async (t) => {
    const { page } = await openBrowser(t, base);
    await page.goto(`${base}/2026-10/syntax/`);
    await setUpKey(page);
    const first = JSON.parse((await storage(page)).local['bk-chat-key']);
    await openSettings(page);
    await page.locator('.bk-chat-menu-item', { hasText: '更换 key' }).click();
    await setUpKey(page, 'sk-test-second-key');
    const second = JSON.parse((await storage(page)).local['bk-chat-key']);
    assert.notEqual(second.credential, first.credential);
    assert.deepEqual(await page.evaluate(() => window.bakeTest.signals), [first.credential]);
  });

  await t.test('a page saved in bake dev gives the chat the new source of the article', async (t) => {
    const { page, api } = await openBrowser(t, base);
    await page.goto(`${base}/2026-10/syntax/`);
    await setUpKey(page);
    await page.evaluate(() => {
      document.querySelector('script.bk-source').textContent = JSON.stringify('# Saved again\n\nThe new text.\n');
      document.dispatchEvent(new Event('bake:content'));
    });
    api.answers.push({ body: text('好的。') });
    await ask(page, '现在写了什么？');
    await page.locator('.bk-chat-reply[data-done]').waitFor();
    assert.match(api.requests.at(-1).body.messages[0].content, /<article>\n# Saved again\n\nThe new text\.\n\n<\/article>/);
  });

  await t.test('a chat closed right after the key is saved leaves the keyboard focus on the pet', async (t) => {
    const { page } = await openBrowser(t, base);
    await page.goto(`${base}/2026-10/syntax/`);
    await setUpKey(page);
    await page.keyboard.press('Escape');
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    assert.equal(await shadow(page, 'return root.activeElement?.className ?? null;'), 'bk-chat-launcher');
  });

  await t.test('Escape with the chat settings open closes only the settings, a second Escape closes the chat, and the settings read the pet of the site once', async (t) => {
    const { page } = await openBrowser(t, base);
    const petReads = [];
    page.on('request', (request) => request.url().endsWith('/_bake/pet/pet.json') && petReads.push(request.url()));
    await page.goto(`${base}/2026-10/syntax/`);
    await setUpKey(page);
    await openSettings(page);
    await page.locator('.bk-chat-credit').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.bk-chat-menu').waitFor({ state: 'detached' });
    await openSettings(page);
    await page.locator('.bk-chat-credit').waitFor();
    assert.equal(petReads.length, 1);
    await page.keyboard.press('Escape');
    await page.locator('.bk-chat-menu').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.bk-chat[data-open]').count(), 1);
    await page.waitForFunction(() => document.querySelector('[data-bake-chat]').shadowRoot.activeElement?.matches('.bk-chat-composer > input'));
    await page.keyboard.press('Escape');
    await page.locator('.bk-chat:not([data-open])').waitFor({ state: 'attached' });
  });

  await t.test('one Escape closes only the chat while the keyboard focus is in it, and only an overlay of the theme while the focus is on the page', async (t) => {
    const { page } = await openBrowser(t, base);
    await page.addInitScript(() => localStorage.setItem('bk-toc', 'tabs'));
    await page.goto(`${base}/2026-10/syntax/`);
    await setUpKey(page);
    const chatOpen = () => page.locator('.bk-chat').evaluate((chat) => chat.hasAttribute('data-open'));
    const focusQuestion = () => page.locator(QUESTION).focus();
    const settle = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    const link = page.locator('.bk-article a.internal-link').first();
    await link.scrollIntoViewIfNeeded();
    await focusQuestion();
    await link.hover();
    await page.locator('.bk-preview.is-on').waitFor();
    await page.keyboard.press('Escape');
    await settle();
    assert.equal(await chatOpen(), false, 'Escape in the chat leaves the chat open');
    assert.equal(await page.locator('.bk-preview.is-on').count(), 1, 'Escape in the chat closes the preview card');

    await page.mouse.move(720, 450);
    await page.locator('.bk-chat-launcher').click();
    await page.waitForFunction(() => document.querySelector('[data-bake-chat]').shadowRoot.activeElement?.matches('.bk-chat-composer > input'));
    await page.locator('.bk-settings-toggle').focus();
    await page.keyboard.press('Enter');
    await page.locator('.bk-settings.is-open').waitFor();
    await page.keyboard.press('Escape');
    await settle();
    assert.equal(await page.locator('.bk-settings.is-open').count(), 0, 'Escape on the settings leaves them open');
    assert.equal(await chatOpen(), true, 'Escape on the settings of the theme closes the chat');
    await page.keyboard.press('Escape');
    await page.locator('.bk-chat:not([data-open])').waitFor({ state: 'attached' });

    await page.locator('.bk-chat-launcher').click();
    await page.waitForFunction(() => document.querySelector('[data-bake-chat]').shadowRoot.activeElement?.matches('.bk-chat-composer > input'));
    await page.locator('.bk-toc-tab').nth(1).hover();
    await page.locator('.bk-toc-index.is-on').waitFor({ state: 'attached' });
    await focusQuestion();
    await page.keyboard.press('Escape');
    await settle();
    assert.equal(await chatOpen(), false, 'Escape in the chat leaves the chat open');
    assert.equal(await page.locator('.bk-toc-index.is-on').count(), 1, 'Escape in the chat closes the chapter card');
  });

  await t.test('an Escape that ends the composition of an input method closes neither the chat nor an overlay of the theme', async (t) => {
    const { page, context } = await openBrowser(t, base);
    await page.goto(`${base}/2026-10/syntax/`);
    await setUpKey(page);
    const link = page.locator('.bk-article a.internal-link').first();
    await link.scrollIntoViewIfNeeded();
    await link.hover();
    await page.locator('.bk-preview.is-on').waitFor();
    await page.locator(QUESTION).focus();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 });
    await page.keyboard.press('Escape');
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('.bk-chat[data-open]').count(), 1, 'Escape during a composition closes the chat');
    assert.equal(await page.locator('.bk-preview.is-on').count(), 1, 'Escape during a composition closes the preview card');
  });

  await t.test('a click where the bubbles were reaches the page while a closed chat fades out, at 1440 and 375 pixels', async (t) => {
    for (const [width, height] of [
      [1440, 900],
      [375, 812],
    ]) {
      const { page, api } = await openBrowser(t, base, { contextOptions: { viewport: { width, height } } });
      await page.goto(`${base}/2026-10/syntax/`);
      await setUpKey(page);
      for (let round = 0; round < 3; round += 1) {
        api.answers.push({ body: text(`第 ${round + 1} 个回答。`) });
        await ask(page, `问题 ${round + 1}`);
        await page.locator('.bk-chat-reply[data-done]').nth(round).waitFor();
      }
      const box = await page.locator('.bk-chat-thread > *').last().boundingBox();
      await page.evaluate(() => {
        window.chatClicks = [];
        document.addEventListener('click', (event) => window.chatClicks.push(event.composedPath().some((node) => node instanceof Element && node.hasAttribute('data-bake-chat'))), { capture: true });
      });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(50);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      assert.deepEqual(await page.evaluate(() => window.chatClicks), [false], `at ${width} pixels the click went to the closed chat`);
    }
  });

  await t.test('every open of the chat, by a click or by Enter on the pet, puts the keyboard focus on the input field, and a chat that the theme hides fades out before it leaves the keyboard order', async (t) => {
    const { context, page } = await openBrowser(t, base);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto(`${base}/2026-10/syntax/`);
    const launcher = page.locator('.bk-chat-launcher');
    const focused = () => page.waitForFunction(() => document.querySelector('[data-bake-chat]').shadowRoot.activeElement?.matches('.bk-chat-composer > input'), null, { timeout: 2000 });
    for (let round = 0; round < 6; round += 1) {
      if (round === 2) {
        await setUpKey(page);
        await page.keyboard.press('Escape');
        await page.locator('.bk-chat:not([data-open])').waitFor({ state: 'attached' });
      }
      if (round === 4) await page.reload();
      await launcher.click();
      await focused();
      await page.keyboard.press('Escape');
      await page.locator('.bk-chat:not([data-open])').waitFor({ state: 'attached' });
      await launcher.focus();
      await page.keyboard.press('Enter');
      await focused();
      await page.keyboard.press('Escape');
      await page.locator('.bk-chat:not([data-open])').waitFor({ state: 'attached' });
    }
    await launcher.click();
    await focused();
    const hidden = () => {
      const root = document.querySelector('[data-bake-chat]').shadowRoot;
      return [getComputedStyle(root.querySelector('.bk-chat-composer')).visibility, getComputedStyle(root.querySelector('.bk-chat-bubbles')).contentVisibility];
    };
    await page.evaluate(() => document.documentElement.style.cssText = '--chat-hidden: 1; --chat-visibility: hidden');
    assert.deepEqual(await page.evaluate(hidden), ['visible', 'visible']);
    await page.waitForFunction(() => {
      const root = document.querySelector('[data-bake-chat]').shadowRoot;
      return getComputedStyle(root.querySelector('.bk-chat-composer')).visibility === 'hidden' && getComputedStyle(root.querySelector('.bk-chat-bubbles')).contentVisibility === 'hidden';
    });
  });

  await t.test('a rejected key is reported before any passkey is created', async (t) => {
    const { page, api } = await openBrowser(t, base);
    api.models = { status: 401, body: '{"error":{"message":"Authentication Fails"}}' };
    await page.goto(`${base}/2026-10/syntax/`);
    await page.locator('.bk-chat-launcher').click();
    await page.locator(KEY).fill('sk-wrong');
    await page.locator(KEY).press('Enter');
    await page.locator('.bk-chat-problem').filter({ hasText: '不接受这个 key' }).waitFor();
    assert.equal(await page.locator(KEY).count(), 1);
    assert.equal((await storage(page)).local['bk-chat-key'], undefined);
  });

  await t.test('a passkey without PRF stores nothing and says why', async (t) => {
    const { page } = await openBrowser(t, base, { prf: false });
    await page.goto(`${base}/2026-10/syntax/`);
    await page.locator('.bk-chat-launcher').click();
    await page.locator(KEY).fill(API_KEY);
    await page.locator(KEY).press('Enter');
    await page.locator('.bk-chat-problem').filter({ hasText: 'PRF' }).waitFor();
    assert.deepEqual((await storage(page)).local, {});
    assert.equal((await page.evaluate(() => window.bakeTest.signals)).length, 1);
  });

  await t.test('a browser without passkeys or without client capabilities, and a page served from an IP address, show no chat', async (t) => {
    const { page, context } = await openBrowser(t, base);
    await page.goto(`${base.replace('localhost', '127.0.0.1')}/2026-10/syntax/`);
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('[data-bake-chat]').count(), 0);
    await context.addInitScript(() => delete PublicKeyCredential.getClientCapabilities);
    await page.goto(`${base}/2026-10/syntax/`);
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('[data-bake-chat]').count(), 0);
    await context.addInitScript(() => delete window.PublicKeyCredential);
    await page.goto(`${base}/2026-10/syntax/`);
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('[data-bake-chat]').count(), 0);
  });

  await t.test('the pet shows its first frame until the pointer or the keyboard reaches it, waves once, and the chat opens and closes from it', async (t) => {
    const { page } = await openBrowser(t, base);
    const pets = [];
    page.on('request', (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.startsWith('/_bake/pet/')) pets.push(pathname);
    });
    await page.goto(`${base}/2026-10/syntax/`);
    await page.waitForLoadState('networkidle');
    assert.deepEqual(pets, ['/_bake/pet/frame.webp']);
    const launcher = page.locator('.bk-chat-launcher');
    assert.deepEqual(await launcher.evaluate((element) => [element.offsetWidth, element.offsetHeight, getComputedStyle(element).backgroundColor, getComputedStyle(element).cursor]), [
      76,
      82,
      'rgba(0, 0, 0, 0)',
      'pointer',
    ]);
    await watchPet(page);
    assert.deepEqual(await page.evaluate(() => window.bakeTest.pet), [petEntry('idle')]);

    await launcher.hover();
    assert.deepEqual(await petSeen(page, 'greet'), petEntry('greet'));
    await page.locator('.bk-chat-launcher .bk-chat-pet[data-ready]').waitFor();
    assert.deepEqual(pets, ['/_bake/pet/frame.webp', '/_bake/pet/spritesheet.webp']);
    await page.waitForFunction(() => window.bakeTest.pet.at(-1).state === 'idle');
    await page.mouse.move(600, 10);

    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Shift+Tab');
    assert.equal(await shadow(page, "return root.activeElement?.className + ' ' + getComputedStyle(root.activeElement).outlineStyle;"), 'bk-chat-launcher solid');
    await page.waitForFunction(() => window.bakeTest.pet.filter((entry) => entry.state === 'greet').length === 2);
    await page.waitForFunction(() => window.bakeTest.pet.at(-1).state === 'idle');

    const chat = page.locator('.bk-chat');
    const closed = async () => {
      await page.locator('.bk-chat:not([data-open])').waitFor({ state: 'attached' });
      await page.waitForFunction(() => window.bakeTest.pet.at(-1).state === 'idle');
      assert.equal(await launcher.getAttribute('aria-expanded'), 'false');
    };
    await launcher.click();
    await page.locator('.bk-chat[data-open]').waitFor();
    assert.deepEqual(await petSeen(page, 'open'), petEntry('open'));
    assert.equal(await launcher.getAttribute('aria-expanded'), 'true');
    assert.match(await chat.evaluate((element) => getComputedStyle(element).transitionProperty), /opacity/);
    const box = await chat.boundingBox();
    const pet = await launcher.boundingBox();
    assert.ok(box.x + box.width <= pet.x && box.width <= 290, JSON.stringify({ box, pet }));
    await page.keyboard.press('Escape');
    await closed();

    await launcher.click();
    await page.locator('.bk-chat[data-open]').waitFor();
    await page.locator('.bk-article p').first().click();
    await closed();

    await launcher.click();
    await page.locator('.bk-chat[data-open]').waitFor();
    await launcher.click();
    await closed();
  });

  await t.test('the pet waits while the key is saved, runs while an answer streams, jumps when it is done and holds the failed pose after an error', async (t) => {
    const { page, api } = await openBrowser(t, base);
    await page.goto(`${base}/2026-10/syntax/`);
    await watchPet(page);
    await setUpKey(page);
    assert.deepEqual(await petSeen(page, 'unlocking'), petEntry('unlocking'));
    await page.evaluate(() => (window.bakeTest.pet = []));
    await page.evaluate(() => (window.bakeTest.hold = true));
    await ask(page, '慢慢说');
    await page.locator('.bk-chat-answer').filter({ hasText: '前半句' }).waitFor();
    assert.deepEqual(await petSeen(page, 'answering'), petEntry('answering'));
    assert.ok(new Set(await sheetTransforms(page)).size > 1, 'the running frames advance');
    await page.locator('.bk-chat-send[data-action="stop"]').click();
    await page.locator('.bk-chat-reply[data-done]').waitFor();
    await page.evaluate(() => (window.bakeTest.hold = false));

    api.answers.push({ body: text('好的。') });
    await ask(page, '你好');
    await page.locator('.bk-chat-reply[data-done]').nth(1).waitFor();
    assert.deepEqual(await petSeen(page, 'answered'), petEntry('answered'));
    await page.waitForFunction(() => window.bakeTest.pet.at(-1).state === 'idle');

    api.answers.push({ status: 500, body: '{"error":{"message":"down"}}' });
    await ask(page, '还在吗？');
    await page.locator('.bk-chat-reply .bk-chat-problem').filter({ hasText: '暂时无法回答' }).waitFor();
    assert.deepEqual(await petSeen(page, 'failed'), petEntry('failed'));
    await page.waitForTimeout(1300);
    assert.equal(await lastPet(page), 'failed');
    assert.equal(await shadow(page, "return getComputedStyle(root.querySelector('.bk-chat-pet-sheet')).transform;"), 'matrix(1, 0, 0, 1, -504, 0)');
  });

  await t.test('with reduced motion the pet shows the first frame of every state', async (t) => {
    const { page, api } = await openBrowser(t, base, { contextOptions: { reducedMotion: 'reduce' } });
    await page.goto(`${base}/2026-10/syntax/`);
    await watchPet(page);
    await page.locator('.bk-chat-launcher').hover();
    assert.deepEqual(await petSeen(page, 'greet'), petEntry('greet', { reduced: true }));
    await setUpKey(page);
    await page.evaluate(() => (window.bakeTest.hold = true));
    await ask(page, '慢慢说');
    await page.locator('.bk-chat-answer').filter({ hasText: '前半句' }).waitFor();
    assert.deepEqual(await petSeen(page, 'answering'), petEntry('answering', { reduced: true }));
    assert.deepEqual(new Set(await sheetTransforms(page)), new Set(['none']));
    await page.locator('.bk-chat-send[data-action="stop"]').click();
    await page.evaluate(() => (window.bakeTest.hold = false));
    api.answers.push({ status: 500, body: '{"error":{"message":"down"}}' });
    await ask(page, '还在吗？');
    assert.deepEqual(await petSeen(page, 'failed'), petEntry('failed', { reduced: true }));
    assert.deepEqual(new Set(await sheetTransforms(page)), new Set(['none']));
  });

  await t.test('@ lists articles, months and topics, and the chosen scopes go into the question and the prompt while the pet reviews', async (t) => {
    const { page, api } = await openBrowser(t, base);
    await page.goto(`${base}/2026-10/syntax/`);
    await watchPet(page);
    await setUpKey(page);
    const input = page.locator(QUESTION);
    const list = page.locator('.bk-chat-scopes [role="listbox"]');
    const chips = () => page.locator('.bk-chat-composer .bk-chat-chip > span').allTextContents();
    const combobox = () => input.evaluate((element) => ['role', 'aria-autocomplete', 'aria-expanded', 'aria-controls', 'aria-activedescendant'].map((name) => element.getAttribute(name)));
    assert.deepEqual(await combobox(), ['combobox', 'list', 'false', null, null]);
    await input.pressSequentially('@');
    await list.waitFor();
    assert.deepEqual(await list.locator('.bk-chat-scopes-group').allTextContents(), ['文章', '月份', '主题（分类和标签）']);
    assert.deepEqual(await combobox(), ['combobox', 'list', 'true', 'bk-chat-scopes', 'bk-chat-scope-0']);
    assert.equal(await list.getAttribute('id'), 'bk-chat-scopes');
    assert.equal(await list.locator('#bk-chat-scope-0').getAttribute('aria-selected'), 'true');
    assert.deepEqual(
      await list.locator('[role="group"]').evaluateAll((groups) => groups.map((group) => group.getRootNode().getElementById(group.getAttribute('aria-labelledby')).textContent)),
      ['文章', '月份', '主题（分类和标签）'],
    );
    await input.press('ArrowDown');
    assert.equal((await combobox())[4], 'bk-chat-scope-1');
    assert.equal(await list.locator('#bk-chat-scope-1').getAttribute('aria-selected'), 'true');
    await input.press('ArrowUp');
    await input.pressSequentially('数学');
    assert.equal(await list.locator('[aria-selected="true"] span').textContent(), '数学');
    assert.equal(await list.locator(`#${(await combobox())[4]} span`).textContent(), '数学');
    assert.deepEqual(await list.locator('.bk-chat-scopes-group').allTextContents(), ['主题（分类和标签）']);
    await input.press('Enter');
    assert.deepEqual(await chips(), ['@数学']);
    assert.equal(await input.inputValue(), '');
    assert.equal(await input.getAttribute('placeholder'), '问这些内容…');
    const choose = async (label) => {
      await list.locator('[role="option"] span', { hasText: label }).first().waitFor();
      const labels = await list.locator('[role="option"] span').allTextContents();
      for (let step = 0; step < labels.indexOf(label); step += 1) await input.press('ArrowDown');
    };
    await input.pressSequentially('@2026-09');
    await choose('2026-09');
    assert.equal(await list.locator('[aria-selected="true"] span').textContent(), '2026-09');
    await input.press('Tab');
    assert.deepEqual(await chips(), ['@数学', '@2026-09']);
    await input.press('Backspace');
    assert.deepEqual(await chips(), ['@数学']);
    await input.pressSequentially('@雅可');
    await choose('雅可比矩阵');
    await input.press('Enter');
    assert.deepEqual(await chips(), ['@数学', '@雅可比矩阵']);
    await input.pressSequentially('@没有这一项');
    await page.locator('.bk-chat-scopes-none').waitFor();
    assert.equal(await page.locator('[role="listbox"] .bk-chat-scopes-none').count(), 0);
    assert.equal(await list.count(), 0);
    assert.deepEqual(await combobox(), ['combobox', 'list', 'false', null, null]);
    await input.fill('');
    await input.pressSequentially('@');
    await list.waitFor();
    await input.press('Escape');
    await list.waitFor({ state: 'detached' });
    assert.deepEqual(await combobox(), ['combobox', 'list', 'false', null, null]);
    assert.equal(await page.locator('.bk-chat[data-open]').count(), 1);
    await input.press('Backspace');

    await page.evaluate(() => (window.bakeTest.pet = []));
    api.answers.push({ body: text('都读了。') });
    await ask(page, '讲了什么？');
    await page.locator('.bk-chat-reply[data-done]').waitFor();
    assert.deepEqual(await petSeen(page, 'reading'), petEntry('reading'));
    assert.deepEqual(await page.locator('.bk-chat-user .bk-chat-chip').allTextContents(), ['@数学', '@雅可比矩阵']);
    assert.deepEqual(await chips(), []);
    const system = api.requests.at(-1).body.messages[0].content;
    assert.match(system, /limited the question to 数学, 雅可比矩阵\./);
    assert.ok(system.includes(`<article address="/2026-10/jacobian/" title="雅可比矩阵">\n${jacobianSource}\n</article>`), 'the chosen article is in the prompt');
    assert.match(system, /"address":"\/2026-10\/syntax-linked\/"/);
    assert.doesNotMatch(system, /"address":"\/2026-10\/activations\/"/);
    assert.ok(!system.includes(syntaxSource), 'the article on the page is left out');
    assert.deepEqual(api.requests.at(-1).body.messages.slice(1), [{ role: 'user', content: '讲了什么？' }]);
  });

  await t.test('older bubbles scroll inside a box of at most 230 pixels without a scrollbar and fade at the top', async (t) => {
    const { page, api } = await openBrowser(t, base);
    await page.goto(`${base}/2026-10/syntax/`);
    await setUpKey(page);
    api.answers.push({ body: text(Array.from({ length: 24 }, (_, index) => `第 ${index + 1} 段。`).join('\n\n'), 40) });
    await ask(page, '写长一点');
    await page.locator('.bk-chat-reply[data-done]').waitFor();
    const bubbles = page.locator('.bk-chat-bubbles');
    assert.ok((await bubbles.boundingBox()).height <= 230);
    assert.equal(await bubbles.evaluate((element) => getComputedStyle(element).scrollbarWidth), 'none');
    const room = await bubbles.evaluate(async (element) => {
      await Promise.all(element.closest('.bk-chat').getAnimations({ subtree: true }).map((animation) => animation.finished));
      const box = element.getBoundingClientRect();
      const rects = [...element.querySelectorAll('.bk-chat-bubble')].map((bubble) => bubble.getBoundingClientRect());
      const launcher = element.getRootNode().querySelector('.bk-chat-launcher').getBoundingClientRect();
      return { left: Math.min(...rects.map((rect) => rect.left - box.left)), right: Math.min(...rects.map((rect) => box.right - rect.right)), bottom: box.bottom - rects.at(-1).bottom, launcher: launcher.left - box.right };
    });
    assert.ok(room.left >= 6 && room.right >= 2 && room.bottom >= 6, `the scroll box cuts off the edges and shadows of the bubbles: ${JSON.stringify(room)}`);
    assert.ok(room.launcher >= 0, `the scroll box covers the launcher: ${JSON.stringify(room)}`);
    await page.locator('.bk-chat-bubbles[data-faded]').waitFor();
    await bubbles.evaluate((element) => (element.scrollTop = -element.scrollHeight));
    await page.locator('.bk-chat-bubbles:not([data-faded])').waitFor();
    await bubbles.evaluate((element) => (element.scrollTop = 0));
    await page.locator('.bk-chat-bubbles[data-faded]').waitFor();
  });

});

test('the shadows and the speed of the AI chat on published pages', async (t) => {
  const base = await buildExample(t);

  await t.test('the bubbles, the input field, the settings menu, the button that asks about a passage and the outline of the pet take their shadows from the theme in the light and the dark scheme', async (t) => {
    const seen = {};
    for (const colorScheme of ['light', 'dark']) {
      const { page, api } = await openBrowser(t, base, { contextOptions: { colorScheme } });
      await page.goto(`${base}/2026-10/syntax/`);
      await setUpKey(page);
      api.answers.push({ body: text('好。') });
      await ask(page, '你好');
      await page.locator('.bk-chat-reply[data-done]').waitFor();
      await openSettings(page);
      seen[colorScheme] = await shadow(
        page,
        `const style = (selector, property) => getComputedStyle(root.querySelector(selector))[property];
        const token = (name) => {
          const probe = document.body.appendChild(document.createElement('div'));
          probe.style.boxShadow = \`var(\${name})\`;
          const value = getComputedStyle(probe).boxShadow;
          probe.remove();
          return value;
        };
        return { button: token('--button-shadow'), card: token('--card-shadow'), bubble: style('.bk-chat-reply', 'boxShadow'), composer: style('.bk-chat-composer', 'boxShadow'), menu: style('.bk-chat-menu', 'boxShadow'), ask: style('.bk-chat-ask', 'boxShadow'), pet: style('.bk-chat-launcher .bk-chat-pet', 'filter') };`,
      );
      const { button, card, bubble, composer, menu, ask: askButton } = seen[colorScheme];
      const report = JSON.stringify(seen[colorScheme]);
      assert.ok(bubble.endsWith(`, ${button}`), report);
      assert.ok(composer.endsWith(`, ${button}`), report);
      assert.equal(menu, card, report);
      assert.equal(askButton, button, report);
    }
    for (const part of ['bubble', 'composer', 'menu', 'ask']) assert.notEqual(seen.light[part], seen.dark[part], `the ${part} has the same shadow in both schemes: ${seen.light[part]}`);
    assert.match(seen.light.pet, /^drop-shadow\(rgba\(0, 0, 0, 0\) /, seen.light.pet);
    assert.doesNotMatch(seen.dark.pet, /rgba\(0, 0, 0, 0\)/, seen.dark.pet);
  });

  await t.test('in the median of seven cycles of opening and closing the chat at a quarter of the CPU speed, the longest main-thread task takes at most 40 milliseconds longer with 30 rounds of conversation than with one and at most 80 milliseconds, at 1440 and 375 pixels', async (t) => {
    const { context, page, api } = await openBrowser(t, base);
    await page.goto(`${base}/2026-10/syntax/`);
    await setUpKey(page);
    const launcher = page.locator('.bk-chat-launcher');
    const cdp = await context.newCDPSession(page);
    const cycle = async () => {
      const box = await launcher.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.locator('.bk-chat[data-open]').waitFor({ state: 'attached' });
      await page.waitForTimeout(400);
      await page.keyboard.press('Escape');
      await page.locator('.bk-chat:not([data-open])').waitFor({ state: 'attached' });
      await page.waitForTimeout(400);
    };
    const measure = async () => {
      await page.keyboard.press('Escape');
      await page.locator('.bk-chat:not([data-open])').waitFor({ state: 'attached' });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const longest = {};
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
        await page.waitForTimeout(400);
        await cycle();
        await cdp.send('HeapProfiler.collectGarbage');
        const cycles = [];
        for (let round = 0; round < 7; round += 1) {
          await context.browser().startTracing(page, { categories: ['toplevel', 'devtools.timeline', 'disabled-by-default-devtools.timeline'] });
          await cycle();
          cycles.push(mainThreadTasks(JSON.parse(await context.browser().stopTracing()))[0]);
        }
        longest[width] = cycles.sort((a, b) => a - b)[3];
      }
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      await page.setViewportSize({ width: 1440, height: 900 });
      await launcher.click();
      await page.locator(QUESTION).waitFor();
      return longest;
    };
    const answer = (round) => text(`第 ${round + 1} 个回答，公式 $x^${round} + \\frac{a_${round}}{b}$ 和 $\\sum_{i=1}^{n} y_i^2$。\n\n${'这是一段较长的回答文字。'.repeat(6)}\n\n$$\n\\int_0^1 f_${round}(x)\\,dx\n$$`, 400);
    for (let round = 0; round < 30; round += 1) {
      if (round === 1) var short = await measure();
      api.answers.push({ body: answer(round) });
      await ask(page, `问题 ${round + 1}`);
      await page.locator('.bk-chat-reply[data-done]').nth(round).waitFor();
    }
    const long = await measure();
    const report = JSON.stringify({ short, long });
    for (const width of [1440, 375]) {
      assert.ok(long[width] <= short[width] + 40, report);
      assert.ok(long[width] <= 80, report);
    }
  });

});

test('the pets and the colours of the AI chat on published pages', async (t) => {
  const base = await buildExample(t);

  await t.test('a reader chooses a pet by the link of its pet.json, and a pet.json or a sheet that is too large or a sheet with the wrong size leaves the pet unchanged', async (t) => {
    const { page, api } = await openBrowser(t, base);
    api.pets['/bun/pet.json'] = JSON.stringify({ id: 'bun', displayName: '<b>Bun</b>', spritesheetPath: 'art/sheet.webp', script: 'alert(1)' });
    api.pets['/bun/art/sheet.webp'] = await petSheet(1536, 1872);
    api.pets['/big/pet.json'] = JSON.stringify({ displayName: 'Big', spritesheetPath: 'sheet.png' });
    api.pets['/big/sheet.png'] = Buffer.alloc(5 * 1024 * 1024 + 1);
    api.pets['/wrong/pet.json'] = JSON.stringify({ displayName: 'Wrong', spritesheetPath: 'sheet.png' });
    api.pets['/wrong/sheet.png'] = await petSheet(192, 208, 'png');
    api.pets['/text/pet.json'] = JSON.stringify({ displayName: 'Text', spritesheetPath: 'sheet.png' });
    api.pets['/text/sheet.png'] = '<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1872"/>';
    api.pets['/huge/pet.json'] = JSON.stringify({ displayName: 'Huge', spritesheetPath: 'sheet.png', padding: ' '.repeat(64 * 1024) });
    await page.goto(`${base}/2026-10/syntax/`);
    const frame = () => shadow(page, "return root.querySelector('.bk-chat-launcher .bk-chat-pet-frame').src;");
    const siteFrame = await frame();
    assert.equal(siteFrame, `${base}/_bake/pet/frame.webp`);
    await openSettings(page);
    assert.equal(await shadow(page, "return root.querySelectorAll('form form').length;"), 0);
    const credit = page.locator('.bk-chat-credit a');
    assert.equal(await credit.textContent(), 'CRT Monitor，作者 wxy，CC BY 4.0，已裁成 9 行并转成有损 WebP');
    assert.equal(await credit.getAttribute('href'), `${base}/_bake/pet/LICENSE.txt`);
    const status = page.locator('.bk-chat-pet-status');
    const choose = async (path, key = false) => {
      const field = page.locator('.bk-chat-pet-form input[name="pet"]');
      await field.fill(`${PETS}${path}`);
      await (key ? field.press('Enter') : page.locator('.bk-chat-pet-form button').click());
      await page.waitForFunction(() => document.querySelector('[data-bake-chat]').shadowRoot.querySelector('.bk-chat-pet-status')?.textContent !== '正在读取…');
    };
    for (const [path, message] of [
      ['/huge/pet.json', 'pet.json 超过 64 KB。'],
      ['/big/pet.json', '形象图片超过 5 MB。'],
      ['/wrong/pet.json', '形象图片是 192x208 像素，需要 1536x1872 或 1536x2288。'],
      ['/text/pet.json', '形象图片不是 PNG 或 WebP 图片。'],
      ['/missing/pet.json', '读不到这个链接，对方网站可能不允许跨域请求。'],
    ]) {
      await choose(path, true);
      assert.equal(await status.textContent(), message);
      assert.equal(await status.getAttribute('data-failed'), '');
      assert.equal((await storage(page)).local['bk-chat-pet'], undefined);
      assert.equal(await frame(), siteFrame);
    }

    await page.evaluate(() => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'bk-chat-pet') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return setItem.call(this, key, value);
      };
      window.restoreSetItem = () => (Storage.prototype.setItem = setItem);
    });
    await choose('/bun/pet.json');
    assert.equal(await status.textContent(), '浏览器的存储空间已满，无法记住这个形象。');
    assert.equal(await frame(), siteFrame);
    await page.evaluate(() => window.restoreSetItem());
    const sheetRequests = () => api.petRequests.filter((request) => request.path === '/bun/art/sheet.webp').length;
    const before = sheetRequests();

    await choose('/bun/pet.json');
    assert.equal(await status.textContent(), '已换成 <b>Bun</b>。');
    assert.equal(await status.getAttribute('data-failed'), null);
    assert.match(await frame(), /^data:image\/webp;base64,/);
    assert.equal(JSON.parse((await storage(page)).local['bk-chat-pet']).url, `${PETS}/bun/pet.json`);
    assert.equal(await credit.count(), 0);
    assert.ok(api.petRequests.length > 0 && api.petRequests.every((request) => request.headers.referer === undefined && request.headers.cookie === undefined), JSON.stringify(api.petRequests));
    await page.locator('.bk-chat-launcher .bk-chat-pet[data-ready]').waitFor();
    assert.equal(sheetRequests() - before, 1);

    await page.reload();
    assert.match(await frame(), /^data:image\/webp;base64,/);
    await page.locator('.bk-chat-launcher').hover();
    await page.locator('.bk-chat-launcher .bk-chat-pet[data-ready]').waitFor();
    const blob = await shadow(page, "return root.querySelector('.bk-chat-launcher .bk-chat-pet-sheet').src;");
    assert.match(blob, /^blob:/);
    await openSettings(page);
    await page.locator('.bk-chat-menu .bk-chat-link', { hasText: '换回默认' }).click();
    assert.equal(await frame(), siteFrame);
    assert.equal(await page.evaluate((url) => fetch(url).then(() => 'read', () => 'revoked'), blob), 'revoked');
    assert.equal((await storage(page)).local['bk-chat-pet'], undefined);
    await credit.waitFor();
  });

  await t.test('a reader pet link that redirects resolves its spritesheetPath against the new address, and a link that does not answer within 30 seconds leaves the pet unchanged', async (t) => {
    const { page, api } = await openBrowser(t, base);
    const sheet = await petSheet(1536, 1872);
    const requested = [];
    const server = createServer((request, response) => {
      requested.push(request.url);
      if (request.url === '/old/pet.json') response.writeHead(302, { ...CORS, location: '/new/pet.json' }).end();
      else if (request.url === '/new/pet.json') response.writeHead(200, CORS).end(JSON.stringify({ displayName: 'Bun', spritesheetPath: 'sheet.webp' }));
      else if (request.url === '/new/sheet.webp') response.writeHead(200, CORS).end(sheet);
      else response.writeHead(404, CORS).end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => server.close());
    api.pets['/slow/pet.json'] = { hang: true };
    await page.clock.install();
    await page.goto(`${base}/2026-10/syntax/`);
    await openSettings(page);
    const field = page.locator('.bk-chat-pet-form input[name="pet"]');
    const status = page.locator('.bk-chat-pet-status');
    const settled = () => page.waitForFunction(() => document.querySelector('[data-bake-chat]').shadowRoot.querySelector('.bk-chat-pet-status')?.textContent !== '正在读取…');
    await field.fill(`${PETS}/slow/pet.json`);
    await field.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-bake-chat]').shadowRoot.querySelector('.bk-chat-pet-status')?.textContent === '正在读取…');
    await page.clock.fastForward(29_000);
    assert.equal(await status.textContent(), '正在读取…');
    await page.clock.fastForward(1_000);
    await settled();
    assert.equal(await status.textContent(), '这个链接在 30 秒内没有回应。');
    assert.equal((await storage(page)).local['bk-chat-pet'], undefined);
    await field.fill(`http://127.0.0.1:${server.address().port}/old/pet.json`);
    await field.press('Enter');
    await settled();
    assert.equal(await status.textContent(), '已换成 Bun。');
    assert.deepEqual(requested, ['/old/pet.json', '/new/pet.json', '/new/sheet.webp']);
  });

  for (const reducedMotion of ['no-preference', 'reduce']) {
    const moves = reducedMotion === 'reduce' ? 'fades where it is' : 'slides out';
    await t.test(`on a phone the pet ${moves} with the essay buttons while the reader scrolls down and while the drawer is open`, async (t) => {
      const { page } = await openBrowser(t, base, { contextOptions: { viewport: { width: 375, height: 700 }, hasTouch: true, reducedMotion } });
      await page.goto(`${base}/2026-10/syntax/`);
      const launcher = page.locator('.bk-chat-launcher');
      await launcher.waitFor();
      const placement = (state) =>
        page.waitForFunction(
          ({ hidden, inPlace }) => {
            const element = document.querySelector('[data-bake-chat]').shadowRoot.querySelector('.bk-chat-launcher');
            const box = element.getBoundingClientRect();
            const opacity = getComputedStyle(element).opacity;
            element.focus();
            const focused = element.getRootNode().activeElement === element;
            element.blur();
            if (!hidden) return box.right <= innerWidth && opacity === '1' && focused;
            return (inPlace ? box.right <= innerWidth : box.left >= innerWidth) && opacity === '0' && !focused;
          },
          { hidden: state === 'hidden', inPlace: reducedMotion === 'reduce' },
        );
      const scrollBy = async (delta) => {
        for (let step = 0; step < 5; step += 1) {
          await page.evaluate((amount) => window.scrollBy(0, amount), delta / 5);
          await page.waitForTimeout(30);
        }
      };
      await placement('shown');
      await scrollBy(800);
      await page.waitForFunction(() => document.documentElement.classList.contains('bk-buttons-hidden'));
      await placement('hidden');
      await scrollBy(-200);
      await page.waitForFunction(() => !document.documentElement.classList.contains('bk-buttons-hidden'));
      await placement('shown');
      await page.locator('.bk-toc-handle').click();
      await page.waitForFunction(() => document.documentElement.classList.contains('bk-toc-drawer-open'));
      await placement('hidden');
      await page.keyboard.press('Escape');
      await placement('shown');
    });
  }

  await t.test('the pet and the bubbles use the pointer cursor, stay inside a phone screen and only fade with reduced motion', async (t) => {
    const { page } = await openBrowser(t, base, { contextOptions: { viewport: { width: 375, height: 700 }, reducedMotion: 'reduce' } });
    await page.goto(`${base}/2026-10/syntax/`);
    const launcher = page.locator('.bk-chat-launcher');
    assert.equal(await launcher.evaluate((element) => getComputedStyle(element).cursor), 'pointer');
    await launcher.click();
    const chat = page.locator('.bk-chat[data-open]');
    await chat.waitFor();
    await page.locator('.bk-chat-note').first().waitFor();
    const box = await chat.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 375 && box.y >= 0 && box.y + box.height <= 700, JSON.stringify(box));
    assert.equal(await launcher.evaluate((element) => getComputedStyle(element).transform), 'none');
    assert.equal(
      await page
        .locator('.bk-chat-bubble')
        .first()
        .evaluate((element) => getComputedStyle(element).translate),
      'none',
    );
    assert.equal(await page.locator('.bk-chat-composer').evaluate((element) => getComputedStyle(element).translate), 'none');
    await page.locator(KEY).fill(API_KEY);
    for (const control of ['.bk-chat-send', '.bk-chat-icon']) assert.equal(await page.locator(control).evaluate((element) => getComputedStyle(element).cursor), 'pointer');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 375);
  });

  await t.test('the launcher and the chat take the colours and the color scheme that the page shows, from the system or from the theme setting', async (t) => {
    for (const [colorScheme, theme] of [['dark', 'system'], ['light', 'dark'], ['dark', 'light']]) {
      const { context, page } = await openBrowser(t, base, { contextOptions: { colorScheme, reducedMotion: 'reduce' } });
      await context.addInitScript((value) => localStorage.setItem('bk-theme', value), theme);
      await page.goto(`${base}/2026-10/syntax/`);
      const launcher = page.locator('.bk-chat-launcher');
      await launcher.click();
      const composer = page.locator('.bk-chat[data-open] .bk-chat-composer');
      await composer.waitFor();
      const expected = await page.evaluate(() => {
        const probe = document.body.appendChild(document.createElement('div'));
        probe.style.cssText = 'background-color: var(--surface); color: var(--ink)';
        const style = getComputedStyle(probe);
        return { surface: style.backgroundColor, ink: style.color, scheme: style.colorScheme, launcherScheme: style.colorScheme };
      });
      const shown = {
        ...(await composer.evaluate((element) => ({ surface: getComputedStyle(element).backgroundColor, ink: getComputedStyle(element).color, scheme: getComputedStyle(element).colorScheme }))),
        launcherScheme: await launcher.evaluate((element) => getComputedStyle(element).colorScheme),
      };
      assert.deepEqual(shown, expected, `${theme} theme in the ${colorScheme} scheme`);
      await context.close();
    }
  });
});
