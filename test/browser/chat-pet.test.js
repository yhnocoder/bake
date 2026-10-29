import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import sharp from 'sharp';
import { scrollInSteps, settle } from './browser.js';
import { CORS, PETS, ask, backdropRoots, openSettings, petEntry, petSeen, setUpKey, shadow, test, text, watchPet } from './chat-page.js';

async function petNow(page, state) {
  await page.waitForFunction((entry) => JSON.stringify(window.bakeTest.pet.at(-1)) === JSON.stringify(entry), petEntry(state));
}

function petSheetShown(page) {
  return page.waitForFunction(() => getComputedStyle(document.querySelector('[data-bake-chat]').shadowRoot.querySelector('.bk-chat-launcher .bk-chat-pet-sheet')).visibility === 'visible');
}

function sheetTransform(page) {
  return shadow(page, "return getComputedStyle(root.querySelector('.bk-chat-pet-sheet')).transform;");
}

async function framesAdvance(page) {
  const first = await sheetTransform(page);
  await page.waitForFunction((first) => getComputedStyle(document.querySelector('[data-bake-chat]').shadowRoot.querySelector('.bk-chat-pet-sheet')).transform !== first, first);
}

function petSheet(width, height, format = 'webp') {
  return sharp({ create: { width, height, channels: 4, background: { r: 40, g: 120, b: 200, alpha: 1 } } })
    [format]()
    .toBuffer();
}

test.describe('the pet of the AI chat on published pages', () => {
  test('the pet shows its first frame until the pointer or the keyboard reaches it, waves once, and the chat opens and closes from it', async ({ openChat }) => {
    const { page } = await openChat();
    const pets = [];
    page.on('request', (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.startsWith('/_bake/pet/')) pets.push(pathname);
    });
    await page.goto('/2026-10/syntax/');
    // why: the chat starts once the browser has said whether it supports passkeys, which can come after the network is idle on a loaded machine
    await page.locator('.bk-chat-pet-frame').evaluate((frame) => frame.decode());
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
    await petSeen(page, 'greet');
    await petSheetShown(page);
    assert.deepEqual(pets, ['/_bake/pet/frame.webp', '/_bake/pet/spritesheet.webp']);
    await petNow(page, 'idle');
    await page.mouse.move(600, 10);

    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Shift+Tab');
    assert.equal(await shadow(page, "return root.activeElement?.className + ' ' + getComputedStyle(root.activeElement).outlineStyle;"), 'bk-chat-launcher solid');
    await page.waitForFunction((greet) => window.bakeTest.pet.filter((entry) => JSON.stringify(entry) === JSON.stringify(greet)).length === 2, petEntry('greet'));
    await petNow(page, 'idle');

    const chat = page.locator('.bk-chat');
    const closed = async () => {
      await page.locator('.bk-chat:not([data-open])').waitFor({ state: 'attached' });
      await petNow(page, 'idle');
      assert.equal(await launcher.getAttribute('aria-expanded'), 'false');
    };
    await launcher.click();
    await page.locator('.bk-chat[data-open]').waitFor();
    assert.deepEqual(await chat.evaluate(backdropRoots), [], 'no ancestor stops the blur of the glass while the chat opens');
    await petSeen(page, 'open');
    assert.equal(await launcher.getAttribute('aria-expanded'), 'true');
    assert.equal(await chat.evaluate((element) => getComputedStyle(element, '::before').backdropFilter.startsWith('blur(')), true, 'the glass blurs the page behind the open chat');
    assert.deepEqual(await chat.evaluate(backdropRoots), [], 'no ancestor stops the blur of the glass while the chat is open');
    const box = await chat.boundingBox();
    const pet = await launcher.boundingBox();
    assert.ok(box.x + box.width <= pet.x && box.width === 400, JSON.stringify({ box, pet }));
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

  test('the pet waits while the key is saved, runs while an answer streams, jumps when it is done and holds the failed pose after an error', async ({ openChat }) => {
    const { page, api } = await openChat();
    await page.goto('/2026-10/syntax/');
    await watchPet(page);
    await setUpKey(page);
    await petSeen(page, 'unlocking');
    await page.evaluate(() => (window.bakeTest.pet = []));
    await page.evaluate(() => (window.bakeTest.hold = true));
    await ask(page, '慢慢说');
    await page.locator('.bk-chat-answer').filter({ hasText: '前半句' }).waitFor();
    await petSeen(page, 'answering');
    await framesAdvance(page);
    await page.locator('.bk-chat-send[data-action="stop"]').click();
    await page.locator('.bk-chat-reply[data-done]').waitFor();
    await page.evaluate(() => (window.bakeTest.hold = false));

    api.answers.push({ body: text('好的。') });
    await ask(page, '你好');
    await page.locator('.bk-chat-reply[data-done]').nth(1).waitFor();
    await petSeen(page, 'answered');
    await petNow(page, 'idle');

    api.answers.push({ status: 500, body: '{"error":{"message":"down"}}' });
    await ask(page, '还在吗？');
    await page.locator('.bk-chat-reply .bk-chat-problem').filter({ hasText: '暂时无法回答' }).waitFor();
    await petSeen(page, 'failed');
    await settle(page);
    await petNow(page, 'failed');
    assert.equal(await sheetTransform(page), 'matrix(1, 0, 0, 1, -504, 0)');
  });

  test('with reduced motion the pet shows the first frame of every state', async ({ openChat }) => {
    const { page, api } = await openChat({ contextOptions: { reducedMotion: 'reduce' } });
    await page.goto('/2026-10/syntax/');
    await watchPet(page);
    await page.locator('.bk-chat-launcher').hover();
    await petSeen(page, 'greet', { reduced: true });
    await setUpKey(page);
    await page.evaluate(() => (window.bakeTest.hold = true));
    await ask(page, '慢慢说');
    await page.locator('.bk-chat-answer').filter({ hasText: '前半句' }).waitFor();
    await petSeen(page, 'answering', { reduced: true });
    assert.equal(await sheetTransform(page), 'none');
    await page.locator('.bk-chat-send[data-action="stop"]').click();
    await page.evaluate(() => (window.bakeTest.hold = false));
    api.answers.push({ status: 500, body: '{"error":{"message":"down"}}' });
    await ask(page, '还在吗？');
    await petSeen(page, 'failed', { reduced: true });
    assert.equal(await sheetTransform(page), 'none');
  });
});

test.describe('the pets and the colours of the AI chat on published pages', () => {
  test('a reader chooses a pet by the link of its pet.json, and a pet.json or a sheet that is too large or a sheet with the wrong size leaves the pet unchanged', async ({ site, openChat }) => {
    const { page, api } = await openChat();
    api.pets['/bun/pet.json'] = JSON.stringify({ id: 'bun', displayName: '<b>Bun</b>', spritesheetPath: 'art/sheet.webp', script: 'alert(1)' });
    api.pets['/bun/art/sheet.webp'] = await petSheet(1536, 1872);
    api.pets['/big/pet.json'] = JSON.stringify({ displayName: 'Big', spritesheetPath: 'sheet.png' });
    api.pets['/big/sheet.png'] = Buffer.alloc(5 * 1024 * 1024 + 1);
    api.pets['/wrong/pet.json'] = JSON.stringify({ displayName: 'Wrong', spritesheetPath: 'sheet.png' });
    api.pets['/wrong/sheet.png'] = await petSheet(192, 208, 'png');
    api.pets['/text/pet.json'] = JSON.stringify({ displayName: 'Text', spritesheetPath: 'sheet.png' });
    api.pets['/text/sheet.png'] = '<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1872"/>';
    api.pets['/huge/pet.json'] = JSON.stringify({ displayName: 'Huge', spritesheetPath: 'sheet.png', padding: ' '.repeat(64 * 1024) });
    await page.goto('/2026-10/syntax/');
    const frame = () => shadow(page, "return root.querySelector('.bk-chat-launcher .bk-chat-pet-frame').src;");
    const siteFrame = await frame();
    assert.equal(siteFrame, `${site.origin}/_bake/pet/frame.webp`);
    await openSettings(page);
    assert.equal(await shadow(page, "return root.querySelectorAll('form form').length;"), 0);
    const credit = page.locator('.bk-chat-credit a');
    assert.equal(await credit.textContent(), 'CRT Monitor，作者 wxy，CC BY 4.0，已裁成 9 行并转成有损 WebP');
    assert.equal(await credit.getAttribute('href'), `${site.origin}/_bake/pet/LICENSE.txt`);
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
      assert.equal(await frame(), siteFrame);
    }
    await page.reload();
    assert.equal(await frame(), siteFrame, 'a pet that failed is not remembered');
    await openSettings(page);

    await page.evaluate(() => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = () => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
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
    assert.equal(await credit.count(), 0);
    assert.ok(api.petRequests.length > 0 && api.petRequests.every((request) => request.headers.referer === undefined && request.headers.cookie === undefined), JSON.stringify(api.petRequests));
    await petSheetShown(page);
    assert.equal(sheetRequests() - before, 1);

    await page.reload();
    assert.match(await frame(), /^data:image\/webp;base64,/);
    await page.locator('.bk-chat-launcher').hover();
    await petSheetShown(page);
    const blob = await shadow(page, "return root.querySelector('.bk-chat-launcher .bk-chat-pet-sheet').src;");
    assert.match(blob, /^blob:/);
    await openSettings(page);
    await page.locator('.bk-chat-menu .bk-chat-link', { hasText: '换回默认' }).click();
    assert.equal(await frame(), siteFrame);
    assert.equal(await page.evaluate((url) => fetch(url).then(() => 'read', () => 'revoked'), blob), 'revoked');
    await credit.waitFor();
    await page.reload();
    assert.equal(await frame(), siteFrame);
  });

  test('a reader pet link that redirects resolves its spritesheetPath against the new address, and a link that does not answer within 30 seconds leaves the pet unchanged', async ({ openChat }) => {
    const { page, api } = await openChat();
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
    server.unref();
    api.pets['/slow/pet.json'] = { hang: true };
    await page.clock.install();
    await page.goto('/2026-10/syntax/');
    await openSettings(page);
    const field = page.locator('.bk-chat-pet-form input[name="pet"]');
    const status = page.locator('.bk-chat-pet-status');
    const settled = () => page.waitForFunction(() => document.querySelector('[data-bake-chat]').shadowRoot.querySelector('.bk-chat-pet-status')?.textContent !== '正在读取…', null, { timeout: 5000 });
    // why: the installed clock also runs with real time, which a loaded machine lets pass between the steps
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
    await field.fill(`${PETS}/slow/pet.json`);
    await field.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-bake-chat]').shadowRoot.querySelector('.bk-chat-pet-status')?.textContent === '正在读取…');
    await page.clock.fastForward(29_000);
    assert.equal(await status.textContent(), '正在读取…');
    await page.clock.fastForward(1_000);
    await settled();
    assert.equal(await status.textContent(), '这个链接在 30 秒内没有回应。');
    await page.clock.resume();
    await field.fill(`http://127.0.0.1:${server.address().port}/old/pet.json`);
    await field.press('Enter');
    await settled();
    assert.equal(await status.textContent(), '已换成 Bun。');
    assert.deepEqual(requested, ['/old/pet.json', '/new/pet.json', '/new/sheet.webp']);
    server.close();
  });

  for (const reducedMotion of ['no-preference', 'reduce']) {
    const moves = reducedMotion === 'reduce' ? 'fades where it is' : 'slides out';
    test(`on a phone the pet ${moves} with the essay buttons while the reader scrolls down and while the drawer is open`, async ({ openChat }) => {
      const { page } = await openChat({ contextOptions: { viewport: { width: 375, height: 700 }, hasTouch: true, reducedMotion } });
      await page.goto('/2026-10/syntax/');
      const launcher = page.locator('.bk-chat-launcher');
      await launcher.waitFor();
      const placement = (state) =>
        page.waitForFunction(
          ({ hidden, inPlace }) => {
            const seenOpacity = (node) => (node === null ? 1 : Number(getComputedStyle(node).opacity) * seenOpacity(node.parentElement ?? node.getRootNode().host ?? null));
            const element = document.querySelector('[data-bake-chat]').shadowRoot.querySelector('.bk-chat-launcher');
            const box = element.getBoundingClientRect();
            const opacity = seenOpacity(element);
            element.focus();
            const focused = element.getRootNode().activeElement === element;
            element.blur();
            if (!hidden) return box.right <= innerWidth && opacity === 1 && focused;
            return (inPlace ? box.right <= innerWidth : box.left >= innerWidth) && opacity === 0 && !focused;
          },
          { hidden: state === 'hidden', inPlace: reducedMotion === 'reduce' },
        );
      await placement('shown');
      await scrollInSteps(page, 800);
      await placement('hidden');
      await scrollInSteps(page, -200);
      await placement('shown');
      await page.locator('.bk-toc-handle').click();
      await placement('hidden');
      await page.keyboard.press('Escape');
      await placement('shown');
    });
  }

});
