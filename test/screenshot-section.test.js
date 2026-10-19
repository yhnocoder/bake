import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { replaceSection, screenshotSection } from '../scripts/screenshot-section.js';

const section = (summary) => screenshotSection({ summary, commit: 'abcdef1234567', runUrl: 'https://example.com/run' });

describe('screenshots section of a pull request description', () => {
  test('is appended after the text the author wrote', () => {
    const body = replaceSection('Before: a.\n\nAfter: b.\n', section('**1 screenshot.**\n'));
    assert.equal(body, `Before: a.\n\nAfter: b.\n\n${section('**1 screenshot.**\n')}`);
  });

  test('replaces only the marked section and keeps the text around it', () => {
    const old = replaceSection('Before: a.', section('old'));
    const body = replaceSection(`${old}\n\nTests: build`, section('new'));
    assert.equal(body, `Before: a.\n\n${section('new')}\n\nTests: build`);
  });

  test('gives the same description when the same run writes it twice', () => {
    const once = replaceSection('Before: a.', section('same'));
    assert.equal(replaceSection(once, section('same')), once);
  });

  test('keeps dollar signs in the description and in the summary literally', () => {
    const summary = 'costs $& and $1';
    const body = replaceSection(replaceSection('Price: $5 and $& stay.', section('old')), section(summary));
    assert.ok(body.startsWith('Price: $5 and $& stay.\n\n'));
    assert.ok(body.includes(summary));
  });

  test('is the whole description when the description is empty', () => {
    assert.equal(replaceSection('', section('x')), section('x'));
    assert.equal(replaceSection(null, section('x')), section('x'));
    assert.equal(replaceSection('\n\n', section('x')), section('x'));
  });

  test('names the short commit and the run', () => {
    const text = section('summary');
    assert.match(text, /^<!-- screenshots:start -->\n## Screenshots\n/);
    assert.match(text, /commit abcdef1 compared with its base branch\. \[Run\]\(https:\/\/example\.com\/run\)/);
    assert.match(text, /\nsummary\n<!-- screenshots:end -->$/);
  });
});
