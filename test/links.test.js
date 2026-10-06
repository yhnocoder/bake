import assert from 'node:assert/strict';
import { test } from 'node:test';
import { observedAttributes } from '../src/client/component.js';
import { brokenLinks, splitHref } from '../src/site/links.js';

test('splitHref 分出地址和解码后的 id', () => {
  assert.deepEqual(splitHref('/a/?x=1#%E9%93%BE'), { path: '/a/', fragment: '链' });
  assert.deepEqual(splitHref('#chain-rule'), { path: '', fragment: 'chain-rule' });
  assert.deepEqual(splitHref('/a/#%E9'), { path: '/a/', fragment: '%E9' });
});

test('brokenLinks 报出不存在的页面和 id', () => {
  const entry = { path: 'content/a.md', url: '/a/' };
  const targets = new Map([['/a/', ['intro']], ['/b/', ['chain-rule']]]);
  const links = [
    { href: '#intro', line: 1, column: 1 },
    { href: '/b/#chain-rule', line: 2, column: 1 },
    { href: '/c/', line: 3, column: 5 },
    { href: '/b/#missing', line: 4, column: 2 },
  ];
  assert.deepEqual(brokenLinks(entry, links, targets), [
    { path: 'content/a.md', line: 3, column: 5, text: 'Link points to a missing page /c/' },
    { path: 'content/a.md', line: 4, column: 2, text: 'Link points to a missing id /b/#missing' },
  ]);
});

test('observedAttributes 使用小写的属性名', () => {
  assert.deepEqual(observedAttributes({ x0: {}, showPath: {} }), ['x0', 'showpath']);
  assert.deepEqual(observedAttributes(), []);
});
