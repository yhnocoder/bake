import assert from 'node:assert/strict';
import { cpSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { bake, createBlog } from '../blog.js';
import { serve } from './server.js';

const exampleBlog = join(import.meta.dirname, '../../examples/blog');
const syntaxSource = readFileSync(join(exampleBlog, 'content/posts/syntax/index.md'), 'utf8');
const jacobianSource = readFileSync(join(exampleBlog, 'content/posts/jacobian/index.md'), 'utf8');
const API_KEY = 'sk-test-0123456789abcdef';
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
  const api = { requests: [], answers: [], models: { status: 200, body: '{"object":"list","data":[]}' } };
  await context.route(
    (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
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

async function setUpKey(page) {
  await page.locator('.bk-chat-launcher').click();
  await page.locator('.bk-chat-setup input[name="key"]').fill(API_KEY);
  await page.locator('.bk-chat-setup .bk-chat-primary').click();
  await page.locator('.bk-chat-composer textarea').waitFor();
}

async function ask(page, question) {
  await page.locator('.bk-chat-composer textarea').fill(question);
  await page.locator('.bk-chat-composer textarea').press('Enter');
}

test('the AI chat on published pages', async (t) => {
  const base = await buildExample(t);

  await t.test('the key is saved with a passkey, the browser stores only ciphertext, and the answer about the article streams with formulas and links', async (t) => {
    const { page, api, problems } = await openBrowser(t, base);
    await page.goto(`${base}/2026-10/syntax/`);
    await page.locator('.bk-chat-launcher').waitFor();
    await setUpKey(page);
    assert.equal(await page.locator('.bk-chat-view').evaluate((element) => getComputedStyle(element).animationName), 'bk-chat-view-in');
    assert.deepEqual(
      api.requests.map((request) => [request.path, request.headers.authorization]),
      [['/models', `Bearer ${API_KEY}`]],
    );
    const stored = await storage(page);
    assert.doesNotMatch(JSON.stringify(stored), new RegExp(API_KEY));
    assert.deepEqual(Object.keys(JSON.parse(stored.local['bk-chat-key'])).sort(), ['credential', 'data', 'iv', 'salt']);

    api.answers.push({ body: text('标题见 [标题](#headings)。公式 $\\R^2$ 和\n\n$$\\frac{a}{b}$$\n\n结束。') });
    await ask(page, '这篇文章讲什么？');
    await page.locator('.bk-chat-reply[data-done] .bk-chat-answer').filter({ hasText: '结束。' }).waitFor();
    await page.locator('.bk-chat-answer .bk-chat-math[data-state="ready"] svg').nth(1).waitFor();
    assert.equal(await page.locator('.bk-chat-answer a').getAttribute('href'), '#headings');
    const request = api.requests.at(-1);
    assert.equal(request.path, '/chat/completions');
    assert.equal(request.headers.authorization, `Bearer ${API_KEY}`);
    assert.equal(request.body.model, 'deepseek-flash');
    assert.equal(request.body.stream, true);
    assert.equal(request.body.tools, undefined);
    assert.equal(request.body.messages[0].role, 'system');
    assert.ok(request.body.messages[0].content.includes(syntaxSource), 'the system message holds the article source');
    assert.match(request.body.messages[0].content, /\n- #headings 标题与锚点\n  - #third-level 三级标题\n/);
    assert.deepEqual(request.body.messages.slice(1), [{ role: 'user', content: '这篇文章讲什么？' }]);
    assert.deepEqual(problems, []);
  });

  await t.test('a reload asks for the passkey once and keeps the conversation going with the decrypted key', async (t) => {
    const { page, api } = await openBrowser(t, base);
    await page.goto(`${base}/2026-10/syntax/`);
    await setUpKey(page);
    await page.reload();
    await page.locator('.bk-chat-launcher').click();
    await page.locator('.bk-chat-composer textarea').waitFor();
    api.answers.push({ body: text('好的。') });
    await ask(page, '再说一次');
    await page.locator('.bk-chat-reply[data-done]').waitFor();
    assert.equal(api.requests.at(-1).headers.authorization, `Bearer ${API_KEY}`);
  });

  await t.test('chatting about the whole blog reads articles with a tool and links into them', async (t) => {
    const { page, api } = await openBrowser(t, base);
    const fetched = [];
    page.on('request', (request) => fetched.push(new URL(request.url()).pathname));
    await page.goto(`${base}/`);
    await setUpKey(page);
    assert.equal(await page.locator('.bk-chat-modes').count(), 0);
    const call = { index: 0, id: 'call_1', type: 'function', function: { name: 'read_article', arguments: '' } };
    api.answers.push({
      body: events(
        [{ role: 'assistant', content: '' }, { tool_calls: [call] }, { tool_calls: [{ index: 0, function: { arguments: '{"address":' } }] }, { tool_calls: [{ index: 0, function: { arguments: '"/2026-10/jacobian/"}' } }] }],
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
    const tool = second.body.messages.at(-1);
    assert.deepEqual(tool, { role: 'tool', tool_call_id: 'call_1', content: jacobianSource });
    assert.deepEqual(second.body.messages.at(-2).tool_calls, [{ id: 'call_1', type: 'function', function: { name: 'read_article', arguments: '{"address":"/2026-10/jacobian/"}' } }]);
  });

  await t.test('a selected passage can be asked about directly', async (t) => {
    const { page, api } = await openBrowser(t, base);
    await page.goto(`${base}/2026-10/syntax/`);
    await setUpKey(page);
    await page.locator('.bk-chat-panel button[aria-label="关闭"]').click();
    await page.evaluate(() => {
      const paragraph = document.querySelector('.bk-article > .bk-block[data-type="paragraph"] p');
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    await page.locator('.bk-chat-ask').click();
    const quote = await page.locator('.bk-chat-quote-text').textContent();
    assert.ok(quote.startsWith('这篇文章列出 Bake 的全部写法'), quote);
    api.answers.push({ body: text('这一段介绍了文章。') });
    await ask(page, '这段是什么意思？');
    await page.locator('.bk-chat-reply[data-done]').waitFor();
    assert.equal(api.requests.at(-1).body.messages.at(-1).content, `> ${quote}\n\n这段是什么意思？`);
    assert.equal(await page.locator('.bk-chat-user blockquote').textContent(), quote);
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
    await page.locator('.bk-chat-panel button[aria-label="更多"]').click();
    await page.locator('.bk-chat-menu button[data-action="clear-key"]').click();
    await page.locator('.bk-chat-setup input[name="key"]').waitFor();
    assert.equal((await storage(page)).local['bk-chat-key'], undefined);
  });

  await t.test('stopping an answer keeps the text written so far and sends it with the next question', async (t) => {
    const { page, api } = await openBrowser(t, base);
    await page.goto(`${base}/2026-10/syntax/`);
    await setUpKey(page);
    await page.evaluate(() => (window.bakeTest.hold = true));
    await ask(page, '慢慢说');
    await page.locator('.bk-chat-answer').filter({ hasText: '前半句' }).waitFor();
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
    assert.deepEqual(
      api.requests.at(-1).body.messages.slice(1).map(({ role, content }) => [role, content]),
      [
        ['user', '慢慢说'],
        ['assistant', '前半句'],
        ['user', '接着说'],
      ],
    );
  });

  await t.test('changing the key replaces the stored key and asks the browser to forget the old passkey', async (t) => {
    const { page } = await openBrowser(t, base);
    await page.goto(`${base}/2026-10/syntax/`);
    await setUpKey(page);
    const first = JSON.parse((await storage(page)).local['bk-chat-key']);
    await page.locator('.bk-chat-panel button[aria-label="更多"]').click();
    await page.locator('.bk-chat-menu button', { hasText: '更换 key' }).click();
    await page.locator('.bk-chat-setup input[name="key"]').fill('sk-test-second-key');
    await page.locator('.bk-chat-setup .bk-chat-primary').click();
    await page.locator('.bk-chat-composer textarea').waitFor();
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

  await t.test('a rejected key is reported before any passkey is created', async (t) => {
    const { page, api } = await openBrowser(t, base);
    api.models = { status: 401, body: '{"error":{"message":"Authentication Fails"}}' };
    await page.goto(`${base}/2026-10/syntax/`);
    await page.locator('.bk-chat-launcher').click();
    await page.locator('.bk-chat-setup input[name="key"]').fill('sk-wrong');
    await page.locator('.bk-chat-setup .bk-chat-primary').click();
    await page.locator('.bk-chat-setup .bk-chat-problem').filter({ hasText: '不接受这个 key' }).waitFor();
    assert.equal((await storage(page)).local['bk-chat-key'], undefined);
  });

  await t.test('a passkey without PRF stores nothing and says why', async (t) => {
    const { page } = await openBrowser(t, base, { prf: false });
    await page.goto(`${base}/2026-10/syntax/`);
    await page.locator('.bk-chat-launcher').click();
    await page.locator('.bk-chat-setup input[name="key"]').fill(API_KEY);
    await page.locator('.bk-chat-setup .bk-chat-primary').click();
    await page.locator('.bk-chat-setup .bk-chat-problem').filter({ hasText: 'PRF' }).waitFor();
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

  await t.test('on a phone the entry slides out with the essay buttons while the reader scrolls down and while the drawer is open', async (t) => {
    const { page } = await openBrowser(t, base, { contextOptions: { viewport: { width: 375, height: 700 }, hasTouch: true } });
    await page.goto(`${base}/2026-10/syntax/`);
    const launcher = page.locator('.bk-chat-launcher');
    await launcher.waitFor();
    const placement = (state) =>
      page.waitForFunction((hidden) => {
        const element = document.querySelector('[data-bake-chat]').shadowRoot.querySelector('.bk-chat-launcher');
        const box = element.getBoundingClientRect();
        const opacity = getComputedStyle(element).opacity;
        element.focus();
        const focused = element.getRootNode().activeElement === element;
        element.blur();
        return hidden ? box.left >= innerWidth && opacity === '0' && !focused : box.right <= innerWidth && opacity === '1' && focused;
      }, state === 'hidden');
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
    await page.waitForFunction(() => document.documentElement.classList.contains('bk-drawer-open'));
    await placement('hidden');
    await page.keyboard.press('Escape');
    await placement('shown');
  });

  await t.test('the entry and the panel use the pointer cursor, stay inside a phone screen and only fade with reduced motion', async (t) => {
    const { page } = await openBrowser(t, base, { contextOptions: { viewport: { width: 375, height: 700 }, reducedMotion: 'reduce' } });
    await page.goto(`${base}/2026-10/syntax/`);
    const launcher = page.locator('.bk-chat-launcher');
    assert.equal(await launcher.evaluate((element) => getComputedStyle(element).cursor), 'pointer');
    await launcher.click();
    const panel = page.locator('.bk-chat-panel.is-open');
    await panel.waitFor();
    const box = await panel.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 375 && box.y >= 0 && box.y + box.height <= 700, JSON.stringify(box));
    assert.equal(await panel.evaluate((element) => getComputedStyle(element).transform), 'none');
    assert.equal(await page.locator('.bk-chat-view').evaluate((element) => getComputedStyle(element).animationName), 'bk-chat-fade-in');
    assert.equal(await page.locator('.bk-chat-primary').evaluate((element) => getComputedStyle(element).cursor), 'pointer');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 375);
  });
});
