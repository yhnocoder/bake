import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, test } from 'node:test';
import sharp from 'sharp';
import { INSTALL_CHROMIUM, SHARE_IMAGE_HEIGHT, SHARE_IMAGE_WIDTH } from '../src/build/share-images.js';
import { startDevServer } from '../src/dev/server.js';
import { article, build, cli, createBlog, decodeImage, readTree, writeFiles } from './blog.js';

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
  const empty = emptyBrowsers(t);
  return spawnSync(process.execPath, [cli, 'build'], { cwd: dir, encoding: 'utf8', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: empty, TMPDIR: empty } });
}

function pixel(png, x, y) {
  const offset = (png.width * y + x) * 4;
  return [...png.data.subarray(offset, offset + 3)];
}

function imageTags(html) {
  return [...html.matchAll(/<meta (?:property="og:image[^"]*"|name="twitter:(?:image|card)") content="[^"]*">/g)].map(([tag]) => tag);
}

describe('share images', () => {
  let cover;
  let photo;
  let still;
  before(async () => {
    still = await sharp({ create: { width: 360, height: 240, channels: 3, background: '#ffff00' } }).avif().toBuffer();
    cover = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#ff0000' } }).png().toBuffer();
    photo = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#00ff00' } }).jpeg().toBuffer();
  });

  test('bake build draws a card for every published article, publishes covers and copies unchanged cards from dist/', async (t) => {
    const dir = createBlog(t, {
      ...blogFiles,
      'content/posts/covered/index.md': article({ title: 'Covered', slug: 'covered', date: '2026-10-01', extra: 'category: notes\ncover: cover.png\n' }),
      'content/posts/photo/index.md': article({ title: 'Photo', slug: 'photo', date: '2026-10-02', extra: 'category: notes\ncover: photo.png\n' }),
      'content/posts/vector/index.md': article({ title: 'Vector', slug: 'vector', date: '2026-10-03', extra: 'category: notes\ncover: cover.svg\n' }),
      'content/posts/still/index.md': article({ title: 'Still', slug: 'still', date: '2026-10-04', extra: 'category: notes\ncover: cover.avif\n' }),
      'content/posts/vector/cover.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="210"><rect width="400" height="210" fill="#0000ff"/></svg>\n',
    });
    writeFileSync(join(dir, 'content/posts/covered/cover.png'), cover);
    writeFileSync(join(dir, 'content/posts/photo/photo.png'), photo);
    writeFileSync(join(dir, 'content/posts/still/cover.avif'), still);
    assert.deepEqual(await build(dir), []);
    const images = readdirSync(join(dir, 'dist/og'), { recursive: true }).filter((path) => path.includes('.')).sort();
    assert.equal(images.length, 6);
    const [plain, covered, photoImage, rope, stillImage, vector] = images;
    assert.match(stillImage, /^2026-10\/still-[0-9a-f]{12}\.png$/);
    const converted = await decodeImage(readFileSync(join(dir, 'dist/og', stillImage)));
    assert.deepEqual([converted.width, converted.height], [360, 240]);
    assert.match(plain, /^2026-09\/plain-[0-9a-f]{12}\.png$/);
    assert.match(covered, /^2026-10\/covered-[0-9a-f]{12}\.png$/);
    assert.match(photoImage, /^2026-10\/photo-[0-9a-f]{12}\.jpg$/);
    assert.match(rope, /^2026-10\/rope-[0-9a-f]{12}\.png$/);
    assert.match(vector, /^2026-10\/vector-[0-9a-f]{12}\.png$/);
    assert.deepEqual(readFileSync(join(dir, 'dist/og', covered)), cover);
    assert.equal(covered, `2026-10/covered-${createHash('sha256').update(cover).digest('hex').slice(0, 12)}.png`);
    assert.deepEqual(readFileSync(join(dir, 'dist/og', photoImage)), photo);
    const raster = await decodeImage(readFileSync(join(dir, 'dist/og', vector)));
    assert.deepEqual([raster.width, raster.height], [400, 210]);
    assert.deepEqual(pixel(raster, 200, 105), [0, 0, 255]);

    const card = await decodeImage(readFileSync(join(dir, 'dist/og', rope)));
    assert.deepEqual([card.width, card.height], [SHARE_IMAGE_WIDTH, SHARE_IMAGE_HEIGHT]);
    assert.deepEqual(pixel(card, 904, 315), MAGENTA);
    assert.deepEqual(pixel(card, 10, 315), [0x2a, 0x78, 0xd6]);
    const withoutPreview = await decodeImage(readFileSync(join(dir, 'dist/og', plain)));
    assert.deepEqual([withoutPreview.width, withoutPreview.height], [SHARE_IMAGE_WIDTH, SHARE_IMAGE_HEIGHT]);
    assert.deepEqual(pixel(withoutPreview, 904, 315), [0xf5, 0xf6, 0xf4]);
    assert.deepEqual(pixel(withoutPreview, 10, 315), [0x1b, 0xaf, 0x7a]);

    const page = (path) => readFileSync(join(dir, 'dist', path), 'utf8');
    const tags = (image, type, width, height) => [
      '<meta name="twitter:card" content="summary_large_image">',
      `<meta property="og:image" content="https://x.github.io/bake/og/${image}">`,
      `<meta property="og:image:type" content="${type}">`,
      `<meta property="og:image:width" content="${width}">`,
      `<meta property="og:image:height" content="${height}">`,
      `<meta name="twitter:image" content="https://x.github.io/bake/og/${image}">`,
    ];
    assert.deepEqual(imageTags(page('2026-10/rope/index.html')), tags(rope, 'image/png', SHARE_IMAGE_WIDTH, SHARE_IMAGE_HEIGHT));
    assert.deepEqual(imageTags(page('2026-10/covered/index.html')), tags(covered, 'image/png', 300, 200));
    assert.deepEqual(imageTags(page('2026-10/photo/index.html')), tags(photoImage, 'image/jpeg', 320, 180));
    assert.deepEqual(imageTags(page('2026-10/vector/index.html')), tags(vector, 'image/png', 400, 210));
    assert.deepEqual(imageTags(page('2026-10/still/index.html')), tags(stillImage, 'image/png', 360, 240));
    assert.deepEqual(imageTags(page('index.html')), ['<meta name="twitter:card" content="summary">']);
    assert.equal(page('2026-09/demo/index.html'), '<!doctype html>\n<p>demo</p>\n');

    const published = readTree(join(dir, 'dist'));
    const second = bakeWithoutChromium(t, dir);
    assert.equal(second.stderr, '');
    assert.deepEqual(readTree(join(dir, 'dist')), published);
  });

  test('draws the first frame of a preview whose file name holds #, ? or %', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': config,
      'content/posts/rope/index.md': article({ title: 'Rope', slug: 'rope', date: '2026-10-14', extra: 'category: ml\npreview: preview#1?100%.js\n' }),
      'content/posts/rope/preview#1?100%.js': preview.replace('./colour.js', './colour%231.js'),
      'content/posts/rope/colour#1.js': "export const colour = '#ff00ff';\n",
    });
    assert.deepEqual(await build(dir), []);
    const [card] = readdirSync(join(dir, 'dist/og/2026-10'));
    assert.deepEqual(pixel(await decodeImage(readFileSync(join(dir, 'dist/og/2026-10', card))), 904, 315), MAGENTA);
  });

  test('the name of a card changes with its title, its preview and the files the preview imports', async (t) => {
    const dir = createBlog(t, blogFiles);
    const nameAfter = async (changes) => {
      writeFiles(dir, changes);
      assert.deepEqual(await build(dir), []);
      return readdirSync(join(dir, 'dist/og/2026-10')).find((name) => name.startsWith('rope-'));
    };
    const first = await nameAfter({});
    assert.match(first, /^rope-[0-9a-f]{12}\.png$/);
    assert.equal(await nameAfter({ 'content/posts/plain/index.md': article({ title: 'Plain 2', slug: 'plain', date: '2026-09-02', extra: 'category: notes\n' }) }), first);
    const afterPreview = await nameAfter({ 'content/posts/rope/preview.js': preview.replace('colour;', 'colour;\n  element.dataset.drawn = "";') });
    assert.notEqual(afterPreview, first);
    const afterImport = await nameAfter({ 'content/posts/rope/colour.js': "export const colour = '#00ffff';\n" });
    assert.notEqual(afterImport, afterPreview);
    const afterTitle = await nameAfter({ [ROPE]: article({ title: 'Rope 2', slug: 'rope', date: '2026-10-14', extra: 'category: ml\npreview: preview.js\nsummary: Rotary positions.\n' }) });
    assert.notEqual(afterTitle, afterImport);
  });

  test('bake dev draws no share images and writes no image tags', async (t) => {
    const dir = createBlog(t, blogFiles);
    const server = await startDevServer(dir, { port: 0, print: () => {} });
    t.after(() => server.close());
    const html = await (await fetch(new URL('2026-10/rope/', server.url))).text();
    assert.deepEqual(imageTags(html), ['<meta name="twitter:card" content="summary">']);
  });

  test('reports a preview that throws at its front matter field together with the errors of other articles and leaves dist/ unchanged', async (t) => {
    const dir = createBlog(t, {
      ...blogFiles,
      'content/posts/plain/index.md': article({ title: 'Plain', slug: 'plain', date: '2026-09-02', extra: 'category: notes\nauthor: me\n' }),
      'content/posts/rope/preview.js': "export default function preview() {\n  throw new Error('no frame');\n}\n",
      'dist/marker.txt': 'old\n',
    });
    assert.deepEqual(await build(dir), [
        'content/posts/plain/index.md:6:1 unknown front matter field "author"',
        `${ROPE}:6:10 the preview cannot be drawn on the share image: no frame`,
      ]);
    assert.deepEqual(Object.keys(readTree(join(dir, 'dist'))), ['marker.txt']);
  });

  test('reports a missing Chromium with the command that installs it and leaves dist/ unchanged', async (t) => {
    const dir = createBlog(t, { ...blogFiles, 'dist/marker.txt': 'old\n' });
    const result = bakeWithoutChromium(t, dir);
    assert.match(
      result.stderr,
      new RegExp(`^content/posts/plain/index\\.md:1:1 the share image needs Chromium, which cannot be launched \\(.+\\); install it with ${INSTALL_CHROMIUM}\n1 error, dist/ was not written\n$`),
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
    assert.deepEqual(await build(dir), [
        'content/posts/rope/index.md:6:8 cover "notes.txt" must be a PNG, JPEG, GIF, WebP, AVIF or SVG image',
        'public/og/2026-10/rope.png:1:1 dist/og/ is reserved for the files Bake writes',
      ]);
  });
});
