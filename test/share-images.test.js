import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, test } from 'node:test';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import { createSite, updateSite } from '../src/build/site.js';
import { article, bake, cli, createBlog, readTree, writeFiles } from './blog.js';

const config = `export default {
  title: 'Notes',
  url: 'https://x.github.io/bake',
  language: 'en',
  categories: [
    { id: 'ml', name: 'ML', color: '#2a78d6' },
    { id: 'notes', name: 'Notes', color: '#1baf7a' },
  ],
};
`;

const MAGENTA = [255, 0, 255];
const preview = "import { colour } from './colour.js';\n\nexport default function preview(element) {\n  element.style.background = colour;\n  return { start() {}, stop() {} };\n}\n";

const blogFiles = {
  'bake.config.js': config,
  'content/posts/rope/index.md': article({ title: 'Rope', slug: 'rope', date: '2026-10-14', extra: 'category: ml\npreview: preview.js\nsummary: Rotary positions.\n' }),
  'content/posts/rope/preview.js': preview,
  'content/posts/rope/colour.js': "export const colour = '#ff00ff';\n",
  'content/posts/plain/index.md': article({ title: 'Plain', slug: 'plain', date: '2026-09-02', extra: 'category: notes\n' }),
  'content/posts/demo/index.md': '---\ntitle: Demo\nslug: demo\ndate: 2026-09-05\ncategory: notes\npage: demo.html\n---\n',
  'content/posts/demo/demo.html': '<!doctype html>\n<p>demo</p>\n',
  'content/posts/draft/index.md': article({ title: 'Draft', slug: 'draft', date: '2026-10-20', extra: 'category: notes\ndraft: true\n' }),
};

const ROPE = 'content/posts/rope/index.md';

function emptyBrowsers(t) {
  const dir = mkdtempSync(join(tmpdir(), 'bake-browsers-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function bakeWithoutChromium(t, dir) {
  return spawnSync(process.execPath, [cli, 'build'], { cwd: dir, encoding: 'utf8', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: emptyBrowsers(t) } });
}

function pixel(png, x, y) {
  const offset = (png.width * y + x) * 4;
  return [...png.data.subarray(offset, offset + 3)];
}

function imageTags(html) {
  return [...html.matchAll(/<meta (?:property="og:image[^"]*"|name="twitter:image") content="[^"]*">/g)].map(([tag]) => tag);
}

describe('share images', () => {
  let cover;
  before(async () => {
    cover = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#ff0000' } }).png().toBuffer();
  });

  test('bake build draws a card for every published article and page, publishes a cover unchanged and copies unchanged cards from dist/', (t) => {
    const dir = createBlog(t, {
      ...blogFiles,
      'content/posts/covered/index.md': article({ title: 'Covered', slug: 'covered', date: '2026-10-01', extra: 'category: notes\ncover: cover.png\n' }),
    });
    writeFileSync(join(dir, 'content/posts/covered/cover.png'), cover);
    const first = bake(dir, 'build');
    assert.equal(first.stderr, '');
    const images = readdirSync(join(dir, 'dist/og'), { recursive: true }).filter((path) => path.includes('.')).sort();
    assert.equal(images.length, 4);
    const [demo, plain, covered, rope] = images;
    assert.match(covered, /^2026-10\/covered-[0-9a-f]{12}\.png$/);
    assert.match(rope, /^2026-10\/rope-[0-9a-f]{12}\.png$/);
    assert.match(demo, /^2026-09\/demo-[0-9a-f]{12}\.png$/);
    assert.match(plain, /^2026-09\/plain-[0-9a-f]{12}\.png$/);
    assert.deepEqual(readFileSync(join(dir, 'dist/og', covered)), cover);

    const card = PNG.sync.read(readFileSync(join(dir, 'dist/og', rope)));
    assert.deepEqual([card.width, card.height], [1200, 630]);
    assert.deepEqual(pixel(card, 904, 315), MAGENTA);
    assert.deepEqual(pixel(card, 10, 315), [0x2a, 0x78, 0xd6]);
    const withoutPreview = PNG.sync.read(readFileSync(join(dir, 'dist/og', plain)));
    assert.deepEqual([withoutPreview.width, withoutPreview.height], [1200, 630]);
    assert.deepEqual(pixel(withoutPreview, 904, 315), [0xf5, 0xf6, 0xf4]);
    assert.deepEqual(pixel(withoutPreview, 10, 315), [0x1b, 0xaf, 0x7a]);

    const page = (path) => readFileSync(join(dir, 'dist', path), 'utf8');
    assert.deepEqual(imageTags(page('2026-10/rope/index.html')), [
      `<meta property="og:image" content="https://x.github.io/bake/og/${rope}">`,
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">',
      `<meta name="twitter:image" content="https://x.github.io/bake/og/${rope}">`,
    ]);
    assert.deepEqual(imageTags(page('2026-10/covered/index.html')), [
      `<meta property="og:image" content="https://x.github.io/bake/og/${covered}">`,
      '<meta property="og:image:width" content="300">',
      '<meta property="og:image:height" content="200">',
      `<meta name="twitter:image" content="https://x.github.io/bake/og/${covered}">`,
    ]);
    assert.equal(page('2026-09/demo/index.html'), '<!doctype html>\n<p>demo</p>\n');

    const published = readTree(join(dir, 'dist'));
    const second = bakeWithoutChromium(t, dir);
    assert.equal(second.stderr, '');
    assert.deepEqual(readTree(join(dir, 'dist')), published);
  });

  test('the name of a card changes with its title, its preview and the files the preview imports', async (t) => {
    const dir = createBlog(t, blogFiles);
    const site = createSite(dir, { shareImages: true });
    const pathAfter = async (changes) => {
      writeFiles(dir, changes);
      const result = await updateSite(site, Object.keys(changes));
      assert.deepEqual(result.errors, []);
      return result.shareImages.find((image) => image.owner === ROPE).path;
    };
    const first = (await updateSite(site)).shareImages.find((image) => image.owner === ROPE).path;
    assert.match(first, /^og\/2026-10\/rope-[0-9a-f]{12}\.png$/);
    assert.equal(await pathAfter({ 'content/posts/plain/index.md': article({ title: 'Plain 2', slug: 'plain', date: '2026-09-02', extra: 'category: notes\n' }) }), first);
    const afterPreview = await pathAfter({ 'content/posts/rope/preview.js': preview.replace('colour;', 'colour;\n  element.dataset.drawn = "";') });
    assert.notEqual(afterPreview, first);
    const afterImport = await pathAfter({ 'content/posts/rope/colour.js': "export const colour = '#00ffff';\n" });
    assert.notEqual(afterImport, afterPreview);
    const afterTitle = await pathAfter({ [ROPE]: article({ title: 'Rope 2', slug: 'rope', date: '2026-10-14', extra: 'category: ml\npreview: preview.js\nsummary: Rotary positions.\n' }) });
    assert.notEqual(afterTitle, afterImport);
  });

  test('bake dev draws no share images and writes no image tags', async (t) => {
    const dir = createBlog(t, blogFiles);
    const result = await updateSite(createSite(dir, { drafts: true, base: '/' }));
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.shareImages, []);
    const rope = result.pages.find((page) => page.article.file === ROPE);
    const html = rope.outputs.find((output) => output.path === '2026-10/rope/index.html').render();
    assert.deepEqual(imageTags(html), []);
    assert.ok(result.pages.every((page) => page.outputs.every((output) => !output.path.startsWith('og/'))));
  });

  test('reports a preview that throws at its front matter field and leaves dist/ unchanged', (t) => {
    const dir = createBlog(t, {
      ...blogFiles,
      'content/posts/rope/preview.js': "export default function preview() {\n  throw new Error('no frame');\n}\n",
      'dist/marker.txt': 'old\n',
    });
    assert.equal(bake(dir, 'build').stderr, `${ROPE}:6:10 the preview cannot be drawn on the share image: no frame\n1 error, dist/ was not written\n`);
    assert.deepEqual(Object.keys(readTree(join(dir, 'dist'))), ['marker.txt']);
  });

  test('reports a missing Chromium with the command that installs it and leaves dist/ unchanged', (t) => {
    const dir = createBlog(t, { ...blogFiles, 'dist/marker.txt': 'old\n' });
    const result = bakeWithoutChromium(t, dir);
    assert.match(
      result.stderr,
      /^content\/posts\/demo\/index\.md:1:1 the share image needs Chromium, which cannot be launched \(.+\); install it with npx playwright install chromium\n1 error, dist\/ was not written\n$/,
    );
    assert.deepEqual(Object.keys(readTree(join(dir, 'dist'))), ['marker.txt']);
  });

  test('reports a cover that is not an image and public files in og/', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': config,
      'content/posts/rope/index.md': article({ extra: 'category: ml\ncover: notes.txt\n' }),
      'content/posts/rope/notes.txt': 'not an image\n',
      'public/og/2026-10/rope.png': 'png\n',
    });
    const result = await updateSite(createSite(dir, { shareImages: true }));
    assert.deepEqual(
      result.errors.map((error) => `${error.file}:${error.line}:${error.column} ${error.message}`),
      [
        'content/posts/rope/index.md:6:8 cover "notes.txt" must be a PNG, JPEG, GIF, WebP, AVIF or SVG image',
        'public/og/2026-10/rope.png:1:1 dist/og/ is reserved for the files Bake writes',
      ],
    );
  });
});
