import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contentType } from '../src/shared/content-types.js';

test('gives each published file its registered media type, with the UTF-8 charset for text', () => {
  assert.deepEqual(
    ['index.html', '2026-10/rope/index.md', 'assets/page-1a2b.js', 'feed.xml', '_bake/articles.json', 'favicon.ico', 'clip.MP4', 'grid.csv', 'font.woff2', 'file'].map(contentType),
    [
      'text/html; charset=utf-8',
      'text/markdown; charset=utf-8',
      'text/javascript; charset=utf-8',
      'application/xml',
      'application/json',
      'image/vnd.microsoft.icon',
      'video/mp4',
      'text/csv; charset=utf-8',
      'font/woff2',
      'application/octet-stream',
    ],
  );
});
