import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serveExample, settle } from './browser.js';
import { QUESTION, ask, openBrowser, openSettings, scrollPage, setUpKey, shadow, text } from './chat-page.js';

test('the keyboard and the pointer in the AI chat on published pages', async (t) => {
  const base = await serveExample(t, { localhost: true });

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

  await t.test('an Enter that confirms a candidate of an input method in Safari, with keyCode 229 after the composition ended, neither picks a scope nor sends the question', async (t) => {
    const { page, api } = await openBrowser(t, base);
    await page.goto(`${base}/2026-10/syntax/`);
    await setUpKey(page);
    const input = page.locator(QUESTION);
    await input.pressSequentially('@');
    await page.locator('.bk-chat-scopes [role="listbox"]').waitFor();
    const requests = api.requests.length;
    await input.dispatchEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, composed: true, cancelable: true });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(await page.locator('.bk-chat-composer .bk-chat-chip').allTextContents(), [], 'the Enter picked a scope');
    assert.equal(await input.inputValue(), '@');
    assert.equal(api.requests.length, requests, 'the Enter sent the question');
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
      await page.locator('.bk-chat:not([data-open])').waitFor({ state: 'attached' });
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      assert.deepEqual(await page.evaluate(() => window.chatClicks), [false], `at ${width} pixels the click went to the closed chat`);
    }
  });

  await t.test('every open of the chat, by a click or by Enter on the pet, puts the keyboard focus on the input field, and a chat that the theme hides on a phone while the reader scrolls down fades out before it leaves the keyboard order', async (t) => {
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
    await page.setViewportSize({ width: 375, height: 812 });
    await launcher.click();
    await focused();
    const fading = page.evaluate(
      () =>
        new Promise((resolve) => {
          const root = document.querySelector('[data-bake-chat]').shadowRoot;
          const frames = [];
          const sample = () => {
            const composer = getComputedStyle(root.querySelector('.bk-chat-composer'));
            frames.push({ opacity: Number(composer.opacity), visibility: composer.visibility });
            if (composer.visibility === 'hidden' && getComputedStyle(root.querySelector('.bk-chat-bubbles')).contentVisibility === 'hidden') resolve(frames);
            else requestAnimationFrame(sample);
          };
          sample();
        }),
    );
    await scrollPage(page, 800);
    const frames = await fading;
    assert.ok(
      frames.some((frame) => frame.visibility === 'visible' && frame.opacity > 0 && frame.opacity < 1),
      `the chat that the theme hides while the reader scrolls fades out before it leaves the keyboard order: ${JSON.stringify(frames)}`,
    );
  });
});
