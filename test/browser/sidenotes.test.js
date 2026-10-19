import assert from 'node:assert/strict';
import { cpSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { article, bake, createBlog } from '../blog.js';
import { serve } from './server.js';

const exampleBlog = join(import.meta.dirname, '../../examples/blog');
const NOTE_GAP = 12;
const LINE_TOLERANCE = 4;

const longNote = (name) => `Note ${name} is long on purpose: it explains a detail in several sentences, so that it takes many lines in the narrow notes column and pushes the notes after it further down the page.`;

const stressArticle = article({
  title: 'Stress',
  slug: 'stress',
  body: [
    'The opening paragraph has no notes.',
    '',
    '## Crowded {#crowded}',
    '',
    `Three numbers sit in one sentence: first[^a], second[^b] and third[^c]. ${'The paragraph goes on for a while. '.repeat(8)}`,
    '',
    ':::{width=wide}',
    '```text',
    'a wide block between the notes '.repeat(6),
    '```',
    ':::',
    '',
    'Right after the wide block another number[^d] follows.',
    '',
    'A filler paragraph. '.repeat(40),
    '',
    'A later paragraph with one more number[^e].',
    '',
    ':::fold{title="Hidden detail"}',
    'Inside the closed fold there is a number[^f].',
    ':::',
    '',
    'The last paragraph.',
    '',
    '[^a]: A short note.',
    '[^b]: Another short note.',
    ...['c', 'd'].map((name) => `[^${name}]: ${longNote(name)}`),
    '[^e]: A short note.',
    '[^f]: The note of the fold.',
    '',
  ].join('\n'),
});

function measureNotes() {
  const layer = document.querySelector('.bk-notes-layer');
  const column = layer.getBoundingClientRect();
  const center = (rect) => rect.top + rect.height / 2;
  const blocks = [...document.querySelectorAll('.bk-article .bk-block')]
    .filter((block) => !layer.contains(block))
    .map((block) => block.getBoundingClientRect())
    .filter((box) => box.height > 0 && box.right > column.left && box.left < column.right)
    .map((box) => ({ top: box.top, bottom: box.bottom }));
  const notes = [...layer.querySelectorAll('.bk-sidenote')].map((note) => {
    const number = note.dataset.sidenote;
    const ref = [...document.querySelectorAll(`.sidenote-ref[data-sidenote="${number}"]`)].find((element) => element.checkVisibility());
    if (note.hidden || ref === undefined) return { number, hidden: note.hidden, referenced: ref !== undefined };
    const before = ref.previousSibling;
    const caret = document.createRange();
    caret.setStart(before, before.length - 1);
    caret.setEnd(before, before.length);
    const firstLine = document.createRange();
    const text = note.querySelector('.bk-sidenote-number').firstChild;
    firstLine.setStart(text, 0);
    firstLine.setEnd(text, 1);
    const box = note.getBoundingClientRect();
    return {
      number,
      hidden: false,
      top: box.top,
      bottom: box.bottom,
      left: box.left,
      text: (({ top, bottom, left, right }) => ({ top, bottom, left, right }))(ref.parentElement.closest('p, li, td, th, .bk-block').getBoundingClientRect()),
      offset: center(firstLine.getBoundingClientRect()) - center(caret.getBoundingClientRect()),
    };
  });
  return { blocks, notes };
}

function checkNotes({ blocks, notes }, label) {
  const shown = notes.filter((note) => !note.hidden).sort((a, b) => a.top - b.top);
  assert.ok(shown.length > 0, `${label}: no sidenote is shown`);
  const reasons = [];
  shown.forEach((note, index) => {
    const name = `${label}, sidenote ${note.number}`;
    const besideText = note.left >= note.text.right || note.top >= note.text.bottom || note.bottom <= note.text.top;
    assert.ok(besideText, `${name}: covers the text that holds its number`);
    const previous = shown[index - 1];
    if (previous !== undefined) assert.ok(note.top >= previous.bottom + NOTE_GAP - 1, `${name}: top ${note.top} overlaps sidenote ${previous.number} that ends at ${previous.bottom}`);
    for (const block of blocks) assert.ok(note.bottom <= block.top || note.top >= block.bottom, `${name}: ${note.top}–${note.bottom} overlaps a block at ${block.top}–${block.bottom}`);
    if (Math.abs(note.offset) <= LINE_TOLERANCE) {
      reasons.push('aligned');
      return;
    }
    assert.ok(note.offset > 0, `${name}: sits ${-note.offset}px above the line of its number`);
    const belowNote = previous !== undefined && Math.abs(note.top - previous.bottom - NOTE_GAP) <= 1;
    const belowBlock = blocks.some((block) => Math.abs(note.top - block.bottom - NOTE_GAP) <= 1);
    assert.ok(belowNote || belowBlock, `${name}: sits ${note.offset}px below the line of its number without a sidenote or block above it`);
    reasons.push(belowNote ? 'below note' : 'below block');
  });
  return reasons;
}

test('sidenotes', async (t) => {
  const dir = createBlog(t, { 'content/posts/stress/index.md': stressArticle });
  cpSync(exampleBlog, dir, { recursive: true, filter: (source) => source !== join(exampleBlog, 'dist') });
  const result = bake(dir, 'build');
  assert.equal(result.stderr, '');
  const base = await serve(t, join(dir, 'dist'));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const wide = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await t.test('never overlap and align with the line of their number at 1440 px in the syntax article', async () => {
    await wide.goto(`${base}/2026-10/syntax/`);
    await wide.evaluate(() => document.fonts.ready);
    checkNotes(await wide.evaluate(measureNotes), 'syntax article');
  });

  await t.test('move below earlier notes and wide blocks and hide while their number is in a closed fold', async () => {
    await wide.goto(`${base}/2026-10/stress/`);
    await wide.evaluate(() => document.fonts.ready);
    const closed = await wide.evaluate(measureNotes);
    const reasons = checkNotes(closed, 'stress article');
    assert.ok(reasons.includes('aligned'), `no sidenote is aligned with its number: ${reasons}`);
    assert.ok(reasons.includes('below note'), `no sidenote moved below an earlier one: ${reasons}`);
    assert.ok(reasons.includes('below block'), `no sidenote moved below a wide block: ${reasons}`);
    assert.deepEqual(
      closed.notes.filter((note) => note.hidden).map((note) => note.number),
      ['6'],
    );
    await wide.click('details.fold > summary');
    await wide.waitForFunction(() => document.querySelector('details.fold').open && document.querySelector('details.fold').getAnimations().length === 0);
    await wide.waitForTimeout(50);
    const opened = await wide.evaluate(measureNotes);
    checkNotes(opened, 'stress article with the fold open');
    assert.deepEqual(
      opened.notes.filter((note) => note.hidden).map((note) => note.number),
      [],
    );
  });

  await t.test('highlight the number and the note and tint the paragraph on hover', async () => {
    await wide.hover('.sidenote-ref[data-sidenote="5"] a');
    const state = await wide.evaluate(() => ({
      reference: document.querySelector('.sidenote-ref[data-sidenote="5"]').classList.contains('is-active'),
      note: document.querySelector('.bk-notes-layer .bk-sidenote[data-sidenote="5"]').classList.contains('is-active'),
      paragraph: document.querySelector('.sidenote-ref[data-sidenote="5"]').closest('p').classList.contains('bk-tinted'),
    }));
    assert.deepEqual(state, { reference: true, note: true, paragraph: true });
  });

  await t.test('show every note under its block when scripts are disabled', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`${base}/2026-10/stress/`);
    const notes = await page.evaluate(() => {
      const sources = document.querySelectorAll('.bk-sidenote');
      return {
        count: sources.length,
        visible: [...sources].filter((note) => note.checkVisibility() && note.getBoundingClientRect().height > 0).map((note) => `${note.dataset.sidenote} ${note.querySelector('.bk-sidenote-body').textContent.trim()}`),
        target: document.querySelector('#sidenote-1')?.checkVisibility() ?? false,
      };
    });
    await context.close();
    assert.equal(notes.count, 6);
    assert.deepEqual(notes.visible, ['1 A short note.', '2 Another short note.', `3 ${longNote('c')}`, `4 ${longNote('d')}`, '5 A short note.', '6 The note of the fold.']);
    assert.equal(notes.target, true);
  });

  await t.test('open under their block when the number is tapped at 375 px and close on a second tap', async () => {
    const context = await browser.newContext({ viewport: { width: 375, height: 760 }, hasTouch: true, isMobile: true });
    const phone = await context.newPage();
    await phone.goto(`${base}/2026-10/stress/`);
    const note = phone.locator('.bk-section .bk-sidenote[data-sidenote="2"]');
    assert.equal(await phone.locator('.bk-notes-layer').isVisible(), false);
    assert.equal(await note.isVisible(), false);
    await phone.locator('.sidenote-ref[data-sidenote="2"] a').tap();
    await phone.waitForFunction(() => {
      const element = document.querySelector('.bk-section .bk-sidenote[data-sidenote="2"]');
      return element.checkVisibility() && element.getAnimations().length === 0;
    });
    const placement = await phone.evaluate(() => {
      const element = document.querySelector('.bk-section .bk-sidenote[data-sidenote="2"]');
      const block = document.querySelector('.sidenote-ref[data-sidenote="2"]').closest('.bk-block');
      const next = element.nextElementSibling?.matches('.bk-sidenote') ? null : element.nextElementSibling;
      return {
        below: element.getBoundingClientRect().top - block.getBoundingClientRect().bottom,
        aboveNext: next === null ? 0 : next.getBoundingClientRect().top - element.getBoundingClientRect().bottom,
        height: element.getBoundingClientRect().height,
        hash: location.hash,
      };
    });
    assert.ok(placement.height > 20, `the open note is ${placement.height}px high`);
    assert.ok(placement.below >= 0 && placement.below < 30, `the note starts ${placement.below}px below its block`);
    assert.ok(placement.aboveNext >= 0, `the note overlaps the next block by ${-placement.aboveNext}px`);
    assert.equal(placement.hash, '');
    await phone.locator('.sidenote-ref[data-sidenote="2"] a').tap();
    await phone.waitForFunction(() => !document.querySelector('.bk-section .bk-sidenote[data-sidenote="2"]').checkVisibility());
    await context.close();
  });
});
