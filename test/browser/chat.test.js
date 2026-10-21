import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { startDevServer } from '../../src/dev/server.js';
import { article, createBlog, exampleBlog, validConfig } from '../blog.js';
import { serveExample, settle } from './browser.js';
import { API_KEY, KEY, QUESTION, ask, backdropRoots, events, openBrowser, openSettings, petSeen, setUpKey, shadow, storage, text, watchPet } from './chat-page.js';
import { isSelectionChunk } from './selection-module.js';

const syntaxSource = readFileSync(join(exampleBlog, 'content/posts/syntax/index.md'), 'utf8');
const jacobianSource = readFileSync(join(exampleBlog, 'content/posts/jacobian/index.md'), 'utf8');

function mainThreadTasks(trace) {
  const events = trace.traceEvents;
  const main = events.find((event) => event.name === 'thread_name' && event.args.name === 'CrRendererMain');
  return events
    .filter((event) => event.pid === main.pid && event.tid === main.tid && event.name === 'RunTask' && event.ph === 'X')
    .map((event) => Math.round(event.dur / 100) / 10)
    .sort((a, b) => b - a);
}

test('the key and the answers of the AI chat on published pages', async (t) => {
  const base = await serveExample(t, { localhost: true });

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
    assert.doesNotMatch(JSON.stringify(await storage(page)), new RegExp(API_KEY));
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

  await t.test('the frosted glass lies under every part of the chat that asks for the key and blurs the page also while it fades in, at 1440 and 375 pixels', async (t) => {
    for (const [width, height] of [[1440, 900], [375, 812]]) {
      const { page } = await openBrowser(t, base, { contextOptions: { viewport: { width, height } } });
      await page.goto(`${base}/2026-09/llm-act-fns/`);
      await page.locator('.bk-chat-launcher').click();
      await page.locator(KEY).waitFor();
      assert.deepEqual(await page.locator('.bk-chat').evaluate(backdropRoots), [], `no ancestor stops the blur of the glass while it fades in at ${width} pixels`);
      await settle(page);
      assert.deepEqual(await page.locator('.bk-chat').evaluate(backdropRoots), [], `no ancestor stops the blur of the glass at ${width} pixels`);
      const layout = await page.locator('.bk-chat').evaluate((chat) => {
        const glass = chat.getBoundingClientRect();
        const style = getComputedStyle(chat, '::before');
        const parts = [...chat.querySelectorAll('.bk-chat-bubble, .bk-chat-composer')].map((part) => part.getBoundingClientRect()).filter((box) => box.width > 0);
        return {
          blur: style.backdropFilter.startsWith('blur('),
          opacity: style.opacity,
          parts: parts.length,
          outside: parts.filter((box) => box.left < glass.left || box.right > glass.right || box.top < glass.top || box.bottom > glass.bottom).length,
        };
      });
      assert.equal(layout.blur && layout.opacity === '1', true, `the glass blurs the page behind the chat at ${width} pixels`);
      assert.ok(layout.parts >= 2, `the key instructions and the key field show at ${width} pixels`);
      assert.equal(layout.outside, 0, `the key instructions and the key field lie on the glass at ${width} pixels`);
      await page.close();
    }
  });

  await t.test('the passkey unlocks the key for 30 days in this browser, and only when a question is sent after that', async (t) => {
    const { context, page, api } = await openBrowser(t, base);
    await context.addInitScript(() => {
      const offset = Number(sessionStorage.getItem('bake-test-day') ?? 0) * 86400000;
      const now = Date.now;
      Date.now = () => now() + offset;
    });
    const unlockNotes = () => page.locator('.bk-chat-note').filter({ hasText: '用通行密钥解锁' }).count();
    const askOnDay = async (day, question) => {
      await page.evaluate((day) => sessionStorage.setItem('bake-test-day', String(day)), day);
      await page.reload();
      await page.locator('.bk-chat-launcher').click();
      await page.locator(QUESTION).waitFor();
      api.answers.push({ body: text('好的。') });
      await ask(page, question);
      await page.locator('.bk-chat-reply[data-done]').waitFor();
      assert.equal(api.requests.at(-1).headers.authorization, `Bearer ${API_KEY}`);
      return unlockNotes();
    };
    await page.goto(`${base}/2026-10/syntax/`);
    await setUpKey(page);
    assert.equal(await askOnDay(0, '再说一次'), 0, 'the next page asks for no passkey');
    assert.equal(await askOnDay(29, '再说一次'), 0, 'the key is still unlocked after 29 days');

    await page.evaluate(() => sessionStorage.setItem('bake-test-day', '31'));
    await page.reload();
    await watchPet(page);
    await page.locator('.bk-chat-launcher').click();
    await page.locator(QUESTION).waitFor();
    assert.equal(await unlockNotes(), 0, 'opening the chat asks for no passkey');
    api.answers.push({ body: text('再说一次。') });
    const completions = () => api.requests.filter((request) => request.path.endsWith('/chat/completions')).length;
    const sent = completions();
    await page.locator(QUESTION).fill('还有吗');
    await page.locator('.bk-chat-composer').evaluate((form) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await page.locator('.bk-chat-note').filter({ hasText: '已解锁' }).waitFor();
    await page.locator('.bk-chat-reply[data-done]').waitFor();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.bk-chat-note').filter({ hasText: '已解锁' }).count(), 1, 'a second submit during the unlock starts no second unlock');
    assert.equal(completions() - sent, 1, 'the question is sent once');
    await petSeen(page, 'unlocking');
    assert.equal(api.requests.at(-1).headers.authorization, `Bearer ${API_KEY}`);
    assert.equal(await unlockNotes(), 1, 'after 31 days the question asks for the passkey');
    assert.equal(await askOnDay(31, '还在吗'), 0, 'the unlock is remembered again');
    assert.equal(await askOnDay(30, '时钟往回拨了'), 1, 'a key remembered for longer than 30 days from now is forgotten');

    await openSettings(page);
    await page.locator('.bk-chat-menu-item[data-action="clear-key"]').click();
    await page.locator('.bk-chat-note').filter({ hasText: 'key 已清除' }).waitFor();
    await page.reload();
    await page.locator('.bk-chat-launcher').click();
    await page.locator(KEY).waitFor();

    await page.addInitScript(() => {
      if (sessionStorage.getItem('bake-test-held-read') !== null) return;
      sessionStorage.setItem('bake-test-held-read', '');
      const open = indexedDB.open.bind(indexedDB);
      const close = IDBDatabase.prototype.close;
      let connections = 0;
      let held = false;
      IDBDatabase.prototype.close = function () {
        connections -= 1;
        return close.call(this);
      };
      window.bakeTest.databaseIdle = () => connections === 0;
      indexedDB.open = (...args) => {
        connections += 1;
        const request = open(...args);
        if (held) return request;
        held = true;
        const late = { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
        request.onupgradeneeded = (event) => {
          late.result = request.result;
          late.onupgradeneeded?.(event);
        };
        request.onsuccess = (event) => {
          late.result = request.result;
          window.bakeTest.releaseRead = () => late.onsuccess?.(event);
        };
        request.onerror = (event) => {
          connections -= 1;
          late.onerror?.(event);
        };
        return late;
      };
    });
    await page.reload();
    await setUpKey(page);
    await page.waitForFunction(() => typeof window.bakeTest.releaseRead === 'function');
    await page.evaluate(() => window.bakeTest.releaseRead());
    await page.waitForFunction(() => window.bakeTest.databaseIdle());
    assert.equal(await askOnDay(30, '还记得吗'), 0, 'a key saved while the chat still reads the remembered key stays unlocked');
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

  await t.test('on phones the button that asks about a selected passage shows while scrolling down hides the chat button', async (t) => {
    const { page } = await openBrowser(t, base, { contextOptions: { viewport: { width: 375, height: 760 } } });
    await page.goto(`${base}/2026-10/syntax/`);
    const launcher = page.locator('.bk-chat-launcher');
    await launcher.waitFor();
    for (let step = 0; step < 6; step += 1) {
      await page.evaluate(() => scrollBy(0, 120));
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
    }
    await launcher.waitFor({ state: 'hidden' });
    await page.evaluate(() => {
      const paragraph = [...document.querySelectorAll('.bk-article p')].find((element) => element.getBoundingClientRect().top > 100);
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    await page.locator('.bk-chat-ask').waitFor();
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

  await t.test('DeepSeek errors are explained with a retry, and a cleared key is asked for again after a reload', async (t) => {
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
    await page.reload();
    await page.locator('.bk-chat-launcher').click();
    await page.locator(KEY).waitFor();
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

  await t.test('changing the key uses the new key and asks the browser to forget the old passkey', async (t) => {
    const { page, api, passkeys } = await openBrowser(t, base);
    await page.goto(`${base}/2026-10/syntax/`);
    await setUpKey(page);
    const first = await passkeys();
    assert.equal(first.length, 1);
    await openSettings(page);
    await page.locator('.bk-chat-menu-item', { hasText: '更换 key' }).click();
    await setUpKey(page, 'sk-test-second-key');
    assert.deepEqual(await page.evaluate(() => window.bakeTest.signals), first);
    api.answers.push({ body: text('好的。') });
    await ask(page, '换了吗');
    await page.locator('.bk-chat-reply[data-done]').waitFor();
    assert.equal(api.requests.at(-1).headers.authorization, 'Bearer sk-test-second-key');
  });

  await t.test('a rejected key is reported before any passkey is created', async (t) => {
    const { page, api, passkeys } = await openBrowser(t, base);
    api.models = { status: 401, body: '{"error":{"message":"Authentication Fails"}}' };
    await page.goto(`${base}/2026-10/syntax/`);
    await page.locator('.bk-chat-launcher').click();
    await page.locator(KEY).fill('sk-wrong');
    await page.locator(KEY).press('Enter');
    await page.locator('.bk-chat-problem').filter({ hasText: '不接受这个 key' }).waitFor();
    assert.equal(await page.locator(KEY).count(), 1);
    assert.deepEqual(await passkeys(), []);
    assert.deepEqual((await storage(page)).local, {});
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
    await petSeen(page, 'reading');
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

  await t.test('older bubbles scroll inside a box of at most 480 pixels at 1440 pixels and 230 pixels on a phone without a scrollbar and fade at the top', async (t) => {
    const { page, api } = await openBrowser(t, base);
    await page.goto(`${base}/2026-10/syntax/`);
    await setUpKey(page);
    api.answers.push({ body: text(Array.from({ length: 24 }, (_, index) => `第 ${index + 1} 段。`).join('\n\n'), 40) });
    await ask(page, '写长一点');
    await page.locator('.bk-chat-reply[data-done]').waitFor();
    const bubbles = page.locator('.bk-chat-bubbles');
    const height = async () => (await bubbles.boundingBox()).height;
    assert.ok((await height()) > 400 && (await height()) <= 480, String(await height()));
    await page.setViewportSize({ width: 375, height: 812 });
    assert.ok((await height()) <= 230, String(await height()));
    await page.setViewportSize({ width: 1440, height: 900 });
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

test('a page saved in bake dev gives the chat the new source of the article', async (t) => {
  const file = 'content/posts/rope/index.md';
  const dir = createBlog(t, { 'bake.config.js': validConfig, [file]: article({ body: 'The first text.\n' }) });
  const server = await startDevServer(dir, { port: 0, print: () => {} });
  t.after(() => server.close());
  const base = new URL(server.url).origin;
  const { page, api } = await openBrowser(t, base);
  await page.goto(`${base}/2026-10/rope/`);
  await setUpKey(page);
  const saved = article({ body: 'The new text.\n' });
  writeFileSync(join(dir, file), saved);
  await page.locator('.bk-article', { hasText: 'The new text.' }).waitFor();
  api.answers.push({ body: text('好的。') });
  await ask(page, '现在写了什么？');
  await page.locator('.bk-chat-reply[data-done]').waitFor();
  assert.ok(api.requests.at(-1).body.messages[0].content.includes(`<article>\n${saved}\n</article>`));
});

test('the shadows and the speed of the AI chat on published pages', async (t) => {
  const base = await serveExample(t, { localhost: true });

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
        return { button: token('--button-shadow'), card: token('--card-shadow'), bubble: style('.bk-chat-reply', 'boxShadow'), composer: style('.bk-chat-composer', 'boxShadow'), menu: style('.bk-chat-menu', 'boxShadow'), ask: getComputedStyle(document.querySelector('[data-bake-chat-ask]').shadowRoot.querySelector('.bk-chat-ask')).boxShadow, pet: style('.bk-chat-launcher .bk-chat-pet', 'filter') };`,
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
      await settle(page.locator('.bk-chat'));
      await page.keyboard.press('Escape');
      await page.locator('.bk-chat:not([data-open])').waitFor({ state: 'attached' });
      await settle(page.locator('.bk-chat'));
    };
    const measure = async () => {
      await page.keyboard.press('Escape');
      await page.locator('.bk-chat:not([data-open])').waitFor({ state: 'attached' });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const longest = {};
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
        await settle(page.locator('.bk-chat'));
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
