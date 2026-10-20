import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CHAT_RULES } from '../../src/chat/context.js';
import { chatLabels } from '../../src/chat/labels.js';
import { noteRules } from '../../src/chat/note.js';
import { API_KEY, QUESTION, ask, buildExample, exampleBlog, openBrowser, setUpKey, storage, text } from './chat-page.js';

const syntaxSource = readFileSync(join(exampleBlog, 'content/posts/syntax/index.md'), 'utf8');
const jacobianSource = readFileSync(join(exampleBlog, 'content/posts/jacobian/index.md'), 'utf8');
const HISTORY = 'bk-chat-history:/';

function chatRequests(api) {
  return api.requests.filter((request) => request.path === '/chat/completions');
}

async function answered(page, count) {
  await page.locator('.bk-chat-reply[data-done]').nth(count - 1).waitFor();
}

async function openMenu(page) {
  await page.getByRole('button', { name: '对话设置' }).click();
  await page.locator('.bk-chat-menu').waitFor();
}

async function openHistory(page) {
  await page.getByRole('button', { name: '历史记录' }).click();
  await page.locator('.bk-chat-history').waitFor();
}

function savedHistory(stored) {
  return JSON.parse(stored.local[HISTORY] ?? '[]');
}

const NOTE = [
  '# 标题与锚点的写法',
  '',
  '## 锚点',
  '',
  '- 每个标题都有锚点。[Bake 写法一览 §02](/2026-10/syntax/#headings)',
  '- 雅可比矩阵按定义写出。[雅可比矩阵 §01](/2026-10/jacobian/#定义)',
  '- 这一条指向不存在的文章。[不存在](/2026-10/nowhere/)',
  '- 这一条指向不存在的小节。[缺的小节](/2026-10/syntax/#nowhere)',
  '',
  '> 标题会得到锚点。',
  '>',
  '> 出自[《Bake 写法一览》§02](/2026-10/syntax/#headings)',
  '',
  '## 还没弄清的',
  '',
  '- 中文标题的锚点怎么生成。',
].join('\n');

test('the history, the notes and the instructions of the AI chat', async (t) => {
  const base = await buildExample(t);

  await t.test('conversations are saved in this browser as they go, listed per article on article pages and grouped by article on the homepage, and can be opened, continued and deleted', async (t) => {
    const { page, api, problems } = await openBrowser(t, base);
    await page.goto(`${base}/2026-10/syntax/`);
    await setUpKey(page);
    api.answers.push({ body: text('第一个回答，见 [标题](#headings)。') }, { body: text('第二个回答。') });
    await ask(page, '第一个问题');
    await answered(page, 1);
    await ask(page, '第二个问题');
    await answered(page, 2);
    let stored = await storage(page);
    assert.doesNotMatch(JSON.stringify(stored), new RegExp(API_KEY));
    const [saved] = savedHistory(stored);
    assert.deepEqual(saved.article, { address: '/2026-10/syntax/', title: 'Bake 写法一览' });
    assert.deepEqual(
      saved.rounds.map((round) => [round.ask.content, round.content]),
      [
        ['第一个问题', '第一个回答，见 [标题](#headings)。'],
        ['第二个问题', '第二个回答。'],
      ],
    );
    assert.equal(saved.note, null);

    await openHistory(page);
    assert.equal(await page.locator('.bk-chat-history-row').count(), 0);
    assert.equal(await page.locator('.bk-chat-history-empty').textContent(), '这篇文章还没有保存的对话');
    assert.equal(await page.locator('.bk-chat-history-foot').textContent(), '只保存在这个浏览器里，最多 50 段。DeepSeek 的 key 不在其中。');
    await page.locator('.bk-chat-history-new').click();
    await page.locator('.bk-chat-history').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.bk-chat-user').count(), 0);

    await openHistory(page);
    const row = page.locator('.bk-chat-history-row');
    assert.equal(await row.count(), 1);
    assert.equal(await row.locator('.bk-chat-history-title').textContent(), '第一个问题');
    assert.equal(await row.locator('small').textContent(), '今天 · 2 轮');
    await row.locator('.bk-chat-history-open').click();
    await page.locator('.bk-chat-history').waitFor({ state: 'detached' });
    assert.deepEqual(await page.locator('.bk-chat-user').allTextContents(), ['第一个问题', '第二个问题']);
    assert.equal(await page.locator('.bk-chat-answer a').getAttribute('href'), '#headings');
    api.answers.push({ body: text('第三个回答。') });
    await ask(page, '第三个问题');
    await answered(page, 3);
    assert.deepEqual(
      chatRequests(api)
        .at(-1)
        .body.messages.slice(1)
        .map((message) => [message.role, message.content]),
      [
        ['user', '第一个问题'],
        ['assistant', '第一个回答，见 [标题](#headings)。'],
        ['user', '第二个问题'],
        ['assistant', '第二个回答。'],
        ['user', '第三个问题'],
      ],
    );
    stored = await storage(page);
    assert.equal(savedHistory(stored).length, 1);
    assert.equal(savedHistory(stored)[0].rounds.length, 3);

    await page.goto(`${base}/2026-10/jacobian/`);
    await page.locator('.bk-chat-launcher').click();
    await page.locator(QUESTION).waitFor();
    await openHistory(page);
    assert.equal(await page.locator('.bk-chat-history-row').count(), 0);

    await page.goto(`${base}/`);
    await page.locator('.bk-chat-launcher').click();
    await page.locator(QUESTION).waitFor();
    await openHistory(page);
    assert.equal(await page.locator('.bk-chat-history-name').textContent(), '《Bake 写法一览》');
    assert.equal(await page.locator('.bk-chat-history-group').getAttribute('aria-label'), '《Bake 写法一览》');
    await page.locator('.bk-chat-history-open').click();
    await page.locator('.bk-chat-note').filter({ hasText: '这段对话来自《Bake 写法一览》，接着问时会读这篇文章。' }).waitFor();
    assert.equal(await page.locator('.bk-chat-answer a').first().getAttribute('href'), `${base}/2026-10/syntax/#headings`);
    api.answers.push({ body: text('第四个回答，见 [标题](#headings)。') });
    await ask(page, '第四个问题');
    await answered(page, 4);
    const system = chatRequests(api).at(-1).body.messages[0].content;
    assert.ok(system.includes(`<article>\n${syntaxSource}\n</article>`), 'the article of a conversation opened on the homepage is its context');
    assert.ok(system.includes('[the heading](/2026-10/syntax/#id)'));
    assert.equal(await page.locator('.bk-chat-answer a').last().getAttribute('href'), `${base}/2026-10/syntax/#headings`);

    await openMenu(page);
    await page.locator('.bk-chat-menu-item', { hasText: '新对话' }).click();
    await openHistory(page);
    await page.locator('.bk-chat-history-row').hover();
    assert.equal(await page.locator('.bk-chat-history-delete').getAttribute('aria-label'), '删除这段对话');
    await page.locator('.bk-chat-history-delete').click();
    assert.equal(await page.locator('.bk-chat-history-row').count(), 0);
    assert.equal(await page.locator('.bk-chat-history-empty').textContent(), '还没有保存的对话');
    assert.deepEqual(savedHistory(await storage(page)), []);
    assert.deepEqual(problems, []);
  });

  await t.test('clearing the key keeps the history, and at most 50 conversations are kept', async (t) => {
    const { page, api } = await openBrowser(t, base);
    await page.goto(`${base}/2026-10/syntax/`);
    await setUpKey(page);
    await page.evaluate((key) => {
      const conversation = (index) => ({ id: `old-${index}`, article: { address: '/2026-10/syntax/', title: 'Bake 写法一览' }, date: '2026-10-01', rounds: [{ ask: { content: `旧问题 ${index}`, scopes: [], bubble: { text: `旧问题 ${index}`, quote: null, scopes: [] } }, content: '旧回答', reasoning: '', reads: [] }], note: null });
      localStorage.setItem(key, JSON.stringify(Array.from({ length: 50 }, (_, index) => conversation(index))));
    }, HISTORY);
    api.answers.push({ body: text('新回答。') });
    await ask(page, '新问题');
    await answered(page, 1);
    const saved = savedHistory(await storage(page));
    assert.equal(saved.length, 50);
    assert.equal(saved[0].rounds[0].ask.content, '新问题');
    assert.equal(saved.at(-1).id, 'old-48');
    await openMenu(page);
    await page.locator('.bk-chat-menu-item[data-action="clear-key"]').click();
    await page.locator('.bk-chat-note').filter({ hasText: 'key 已清除' }).waitFor();
    const stored = await storage(page);
    assert.equal(stored.local['bk-chat-key'], undefined);
    assert.equal(savedHistory(stored).length, 50);
    await openHistory(page);
    assert.equal(await page.locator('.bk-chat-history-row').count(), 50);
    assert.equal(await page.locator('.bk-chat-history-row small').nth(1).textContent(), '10-01 · 1 轮');
  });

  await t.test('a conversation becomes a note with checked links, which is copied, rewritten on request, kept in versions and saved with its conversation', async (t) => {
    const { page, api, problems } = await openBrowser(t, base);
    await page.goto(`${base}/2026-10/syntax/`);
    await setUpKey(page);
    const read = { index: 0, id: 'call_1', type: 'function', function: { name: 'read_article', arguments: '{"address":"/2026-10/jacobian/"}' } };
    api.answers.push({ body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [read] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n` });
    api.answers.push({ body: text('标题有锚点，雅可比矩阵见 [定义](/2026-10/jacobian/#定义)。') });
    await ask(page, '标题怎么写？');
    await answered(page, 1);
    const link = page.locator('.bk-chat-note-link');
    assert.equal(await link.textContent(), '整理成笔记');

    api.answers.push({ body: text(NOTE, 40) });
    await link.click();
    await page.locator('.bk-chat-note-card').waitFor();
    const request = chatRequests(api).at(-1).body;
    assert.equal(request.tools, undefined);
    const [system, user] = request.messages;
    assert.match(system.content, /^You write a study note from a conversation/);
    assert.ok(system.content.includes(`title="Bake 写法一览">\n${syntaxSource}\n</article>`), 'the note prompt holds the article');
    assert.ok(system.content.includes(`title="雅可比矩阵">\n${jacobianSource}\n</article>`), 'the note prompt holds the article that the conversation read');
    assert.ok(system.content.includes('## 还没弄清的'));
    assert.equal(user.content, '<conversation>\n<reader>\n标题怎么写？\n</reader>\n<assistant>\n标题有锚点，雅可比矩阵见 [定义](/2026-10/jacobian/#定义)。\n</assistant>\n</conversation>');

    const card = page.locator('.bk-chat-note-card');
    assert.equal(await card.locator('.bk-chat-note-label').textContent(), '笔记 · 整理自 1 轮对话 · 引用 2 篇文章');
    assert.equal(await card.locator('h4').textContent(), '标题与锚点的写法');
    assert.equal(await card.locator('.bk-chat-note-intro').textContent(), `整理自 ${await page.evaluate(() => new Date().toLocaleDateString('sv'))} 在《Bake 写法一览》的对话。`);
    assert.deepEqual(await card.locator('h5').allTextContents(), ['锚点', '还没弄清的']);
    assert.deepEqual(
      await card.locator('.bk-chat-note-body li a').evaluateAll((links) => links.map((link) => [link.textContent, link.getAttribute('href')])),
      [
        ['Bake 写法一览 §02', `${base}/2026-10/syntax/#headings`],
        ['雅可比矩阵 §01', `${base}/2026-10/jacobian/#%E5%AE%9A%E4%B9%89`],
      ],
    );
    assert.deepEqual(await card.locator('.bk-chat-note-body li').nth(2).textContent(), '这一条指向不存在的文章。不存在');
    assert.deepEqual(await card.locator('.bk-chat-note-body li').nth(3).textContent(), '这一条指向不存在的小节。缺的小节');
    assert.equal(await card.locator('blockquote cite').textContent(), '出自《Bake 写法一览》§02');
    assert.equal(await page.locator('.bk-chat-bubbles').isVisible(), false);
    assert.equal((await page.locator('.bk-chat').boundingBox()).width, 500, 'the chat widens for the note');

    await card.getByRole('button', { name: 'Markdown', exact: true }).click();
    const markdown = await card.locator('.bk-chat-note-source').textContent();
    assert.ok(markdown.startsWith(`# 标题与锚点的写法\n\n整理自 `));
    assert.ok(markdown.includes(`在[《Bake 写法一览》](${base}/2026-10/syntax/)的对话。`));
    assert.ok(markdown.includes(`[Bake 写法一览 §02](${base}/2026-10/syntax/#headings)`));
    assert.ok(markdown.includes(`> 出自[《Bake 写法一览》§02](${base}/2026-10/syntax/#headings)`));
    assert.ok(markdown.includes('- 这一条指向不存在的文章。不存在\n'));
    await card.getByRole('button', { name: '复制 Markdown' }).click();
    await card.locator('.bk-chat-note-hint', { hasText: '已复制 Markdown。' }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), markdown);
    await page.evaluate(() => {
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        window.bakeTest.downloads = [...(window.bakeTest.downloads ?? []), this.download];
        return click.call(this);
      };
    });
    const download = page.waitForEvent('download');
    await card.getByRole('button', { name: '下载 .md' }).click();
    assert.equal(readFileSync(await (await download).path(), 'utf8'), markdown);
    assert.deepEqual(await page.evaluate(() => window.bakeTest.downloads), ['标题与锚点的写法.md']);
    await card.locator('.bk-chat-note-hint', { hasText: '已下载 标题与锚点的写法.md。' }).waitFor();

    await card.locator('.bk-chat-note-foot').getByRole('button', { name: '重新整理' }).click();
    const redo = card.locator('.bk-chat-redo[data-open] textarea');
    await redo.waitFor();
    assert.equal(await page.evaluate(() => document.querySelector('[data-bake-chat]').shadowRoot.activeElement?.id), 'bk-chat-redo-request');
    assert.equal(await card.locator('.bk-chat-redo label').textContent(), '想怎么改这篇笔记？');
    await page.keyboard.press('Enter');
    assert.equal(await redo.getAttribute('placeholder'), '先写一句要求，比如：写短一点');
    await card.locator('.bk-chat-redo-chip', { hasText: '写短一点' }).click();
    await page.keyboard.press('Escape');
    await card.locator('.bk-chat-redo:not([data-open])').waitFor();
    assert.equal(await card.isVisible(), true);
    const focused = () => page.evaluate(() => document.querySelector('[data-bake-chat]').shadowRoot.activeElement?.textContent ?? null);
    assert.equal(await focused(), '重新整理');
    await card.locator('.bk-chat-note-foot').getByRole('button', { name: '重新整理' }).click();
    await card.locator('.bk-chat-redo-chip', { hasText: '加自测题' }).focus();
    await page.keyboard.press('Escape');
    await card.locator('.bk-chat-redo:not([data-open])').waitFor();
    assert.equal(await focused(), '重新整理');
    assert.equal(await card.isVisible(), true);
    await card.locator('.bk-chat-note-foot').getByRole('button', { name: '重新整理' }).click();
    await redo.fill('只留锚点');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('写短一点');
    api.answers.push({ body: text('# 锚点\n\n- 每个标题都有锚点。[Bake 写法一览 §02](/2026-10/syntax/#headings)') });
    await page.keyboard.press('Enter');
    await card.locator('.bk-chat-note-count', { hasText: '第 2/2 版' }).waitFor();
    const rewrite = chatRequests(api).at(-1).body.messages[1].content;
    assert.ok(rewrite.includes('<note>\n# 标题与锚点的写法\n'));
    assert.ok(rewrite.includes('[Bake 写法一览 §02](/2026-10/syntax/#headings)'));
    assert.ok(rewrite.endsWith('Rewrite this note as the reader asks: 只留锚点\n写短一点\nKeep what the request does not ask to change.'));
    assert.equal(await card.locator('h4').textContent(), '锚点');
    assert.equal(await card.locator('.bk-chat-note-intro').nth(1).textContent(), '按要求重新整理：只留锚点\n写短一点');
    await card.getByRole('button', { name: '上一版' }).click();
    assert.equal(await card.locator('h4').textContent(), '标题与锚点的写法');
    assert.equal(await card.getByRole('button', { name: '上一版' }).isDisabled(), true);

    await page.keyboard.press('Escape');
    await card.waitFor({ state: 'detached' });
    assert.equal(await link.textContent(), '查看笔记');
    const [saved] = savedHistory(await storage(page));
    assert.equal(saved.note.versions.length, 2);
    assert.equal(saved.note.index, 1);
    assert.equal(saved.note.versions[1].request, '只留锚点\n写短一点');
    await openMenu(page);
    assert.equal(await page.locator('.bk-chat-menu-item', { hasText: '查看笔记' }).count(), 1);
    await page.locator('.bk-chat-menu-item', { hasText: '新对话' }).click();
    await openHistory(page);
    assert.equal(await page.locator('.bk-chat-history-row .bk-chat-badge').textContent(), '笔记');
    await page.locator('.bk-chat-history-open').click();
    await page.locator('.bk-chat-note-link', { hasText: '查看笔记' }).click();
    assert.equal(await card.locator('h4').textContent(), '锚点');
    const fading = page.evaluate(
      () =>
        new Promise((resolve) => {
          const chat = document.querySelector('[data-bake-chat]').shadowRoot.querySelector('.bk-chat');
          const frames = [];
          const sample = () => {
            const opacity = Number(getComputedStyle(chat, '::before').opacity);
            frames.push({ opacity, card: chat.querySelector('.bk-chat-note-card') !== null, width: Math.round(chat.getBoundingClientRect().width) });
            if (opacity === 0 && !chat.hasAttribute('data-open')) setTimeout(() => resolve({ frames, card: chat.querySelector('.bk-chat-note-card') !== null }), 50);
            else requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }),
    );
    await page.locator('.bk-chat-launcher').click();
    const fade = await fading;
    const shown = fade.frames.filter((frame) => frame.opacity > 0);
    assert.ok(shown.length > 1, JSON.stringify(fade.frames));
    assert.deepEqual(new Set(shown.map((frame) => `${frame.card} ${frame.width}`)), new Set([`true ${shown[0].width}`]), 'the note card stays at its size while the glass fades out');
    assert.equal(fade.card, false, 'the note card closes once the glass has faded out');
    await page.locator('.bk-chat-launcher').click();
    await page.locator('.bk-chat-bubbles').waitFor();
    assert.equal(await card.count(), 0);
    await page.keyboard.press('Escape');
    await page.locator('.bk-chat:not([data-open])').waitFor();
    assert.deepEqual(problems, []);
  });

  await t.test('a note that the model cannot write is reported, and a blocked clipboard selects the Markdown instead', async (t) => {
    const { page, api } = await openBrowser(t, base, { contextOptions: { permissions: [] } });
    await page.goto(`${base}/`);
    await setUpKey(page);
    api.answers.push({ body: text('回答。') });
    await ask(page, '问题');
    await answered(page, 1);
    api.answers.push({ status: 500, body: '{"error":{"message":"busy"}}' });
    await page.locator('.bk-chat-note-link').click();
    await page.locator('.bk-chat-problem', { hasText: 'DeepSeek 暂时无法回答' }).waitFor();
    assert.equal(await page.locator('.bk-chat-note').filter({ hasText: '正在把这段对话整理成笔记' }).count(), 0);
    api.answers.push({ body: text('# 博客\n\n- 一条要点。') });
    await page.locator('.bk-chat-note-link').click();
    const card = page.locator('.bk-chat-note-card');
    await card.waitFor();
    assert.equal(await card.locator('.bk-chat-note-intro').textContent(), `整理自 ${await page.evaluate(() => new Date().toLocaleDateString('sv'))} 关于整个博客的对话。`);
    assert.equal(await card.locator('.bk-chat-note-label').textContent(), '笔记 · 整理自 1 轮对话');
    await page.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
    });
    await card.getByRole('button', { name: '复制 Markdown' }).click();
    await card.locator('.bk-chat-note-hint', { hasText: '浏览器不允许复制' }).waitFor();
    assert.equal(await card.locator('.bk-chat-note-source').isVisible(), true);
    assert.equal(await page.evaluate(() => getSelection().toString().trimEnd()), (await card.locator('.bk-chat-note-source').textContent()).trimEnd());
  });

  await t.test('the tabs of the prompt form fit the form in Chinese and in English at 375 pixels', async (t) => {
    for (const lang of ['zh-CN', 'en']) {
      const { page } = await openBrowser(t, base, { contextOptions: { viewport: { width: 375, height: 812 } } });
      await page.route(`${base}/2026-10/syntax/`, async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace('<html lang="zh-CN"', `<html lang="${lang}"`) });
      });
      await page.goto(`${base}/2026-10/syntax/`);
      await setUpKey(page);
      await page.locator('.bk-chat-icon').last().click();
      await page.locator('.bk-chat-menu-item').filter({ hasText: lang === 'en' ? 'Prompts' : '提示词' }).click();
      const tabs = page.locator('.bk-chat-prompt-tabs');
      await tabs.waitFor();
      const fit = await tabs.evaluate((list) => [...list.children].map((tab) => ({ text: tab.textContent, clipped: tab.scrollWidth > tab.clientWidth, outside: tab.getBoundingClientRect().right > list.getBoundingClientRect().right + 0.5 })));
      assert.deepEqual(fit.filter((tab) => tab.clipped || tab.outside), [], `${lang}: ${JSON.stringify(fit)}`);
      await page.close();
    }
  });

  await t.test('instructions and built-in prompts written in the chat settings are stored in this browser and used in every request', async (t) => {
    const { page, api } = await openBrowser(t, base);
    await page.goto(`${base}/2026-10/syntax/`);
    await setUpKey(page);
    await openMenu(page);
    await page.locator('.bk-chat-menu-item', { hasText: '提示词' }).click();
    const form = page.locator('.bk-chat-prompt');
    await form.waitFor();
    assert.equal(await page.evaluate(() => document.querySelector('[data-bake-chat]').shadowRoot.activeElement?.id), 'bk-chat-prompt-text');
    assert.deepEqual(await form.getByRole('tab').allTextContents(), ['额外要求', '对话提示词', '笔记提示词']);
    assert.equal(await form.getByRole('tab', { selected: true }).textContent(), '额外要求');
    await page.keyboard.type('回答不超过三句话。');
    await page.keyboard.press('Escape');
    await form.waitFor({ state: 'detached' });
    assert.equal((await storage(page)).local['bk-chat-instructions'], undefined);
    await openMenu(page);
    await page.locator('.bk-chat-menu-item', { hasText: '提示词' }).click();
    await form.locator('#bk-chat-prompt-text').fill('回答不超过三句话。');
    await form.getByRole('button', { name: '保存' }).click();
    await page.locator('.bk-chat-note', { hasText: '提示词已保存。' }).waitFor();
    assert.equal((await storage(page)).local['bk-chat-instructions'], '回答不超过三句话。');
    await openMenu(page);
    assert.equal(await page.locator('.bk-chat-menu-state').textContent(), '已修改');
    await page.locator('.bk-chat-menu-item', { hasText: '提示词' }).click();
    const chatRules = form.locator('#bk-chat-prompt-chat');
    const noteField = form.locator('#bk-chat-prompt-note');
    assert.equal(await chatRules.isVisible(), false);
    await form.getByRole('tab', { name: '额外要求' }).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await form.getByRole('tab', { selected: true }).textContent(), '对话提示词');
    assert.equal(await chatRules.inputValue(), CHAT_RULES);
    assert.equal(await form.locator('.bk-chat-prompt-hint').textContent(), chatLabels('zh').promptHints.chat);
    await chatRules.fill('你是这个博客的助手，回答要有礼貌。');
    await form.getByRole('tab', { name: '笔记提示词' }).click();
    assert.equal(await noteField.inputValue(), noteRules(chatLabels('zh')));
    await form.getByRole('button', { name: '保存' }).click();
    await page.locator('.bk-chat-note', { hasText: '提示词已保存。' }).last().waitFor();
    assert.equal((await storage(page)).local['bk-chat-rules'], '你是这个博客的助手，回答要有礼貌。');
    assert.equal((await storage(page)).local['bk-chat-note-rules'], undefined);
    api.answers.push({ body: text('好。') }, { body: text('# 笔记\n\n- 好。') });
    await ask(page, '问题');
    await answered(page, 1);
    await page.locator('.bk-chat-note-link').click();
    await page.locator('.bk-chat-note-card').waitFor();
    const [chat, note] = chatRequests(api).slice(-2);
    for (const request of [chat, note]) assert.ok(request.body.messages[0].content.endsWith('<reader-instructions>\n回答不超过三句话。\n</reader-instructions>'));
    assert.ok(chat.body.messages[0].content.startsWith('你是这个博客的助手，回答要有礼貌。\nThe blog is "'));
    assert.ok(!chat.body.messages[0].content.includes(CHAT_RULES));
    assert.ok(note.body.messages[0].content.startsWith(`${noteRules(chatLabels('zh'))}\nThe blog is "`));
    await page.reload();
    await page.locator('.bk-chat-launcher').click();
    await openMenu(page);
    await page.locator('.bk-chat-menu-item', { hasText: '提示词' }).click();
    assert.equal(await form.locator('#bk-chat-prompt-text').inputValue(), '回答不超过三句话。');
    await form.getByRole('button', { name: '清空' }).click();
    await form.getByRole('tab', { name: '对话提示词' }).click();
    assert.equal(await chatRules.inputValue(), '你是这个博客的助手，回答要有礼貌。');
    await form.getByRole('button', { name: '恢复默认' }).click();
    assert.equal(await chatRules.inputValue(), CHAT_RULES);
    await page.keyboard.press('Control+Enter');
    await page.locator('.bk-chat-note', { hasText: '提示词已保存，现在用的是内置提示词，没有额外要求。' }).waitFor();
    const local = (await storage(page)).local;
    for (const key of ['bk-chat-instructions', 'bk-chat-rules', 'bk-chat-note-rules']) assert.equal(local[key], undefined);
    await openMenu(page);
    assert.equal(await page.locator('.bk-chat-menu-state').count(), 0);
  });
});
