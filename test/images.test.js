import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { describe, test } from 'node:test';
import sharp from 'sharp';
import { folder, outline, parse, parsed } from './article.js';
import { article, bake, createBlog, validConfig } from './blog.js';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"/>';

async function png(width, height) {
  return sharp({ create: { width, height, channels: 3, background: '#985b57' } }).png().toBuffer();
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function hugePng() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(20000, 0);
  header.writeUInt32BE(20000, 4);
  header[8] = 8;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(Buffer.alloc(10))), pngChunk('IEND', Buffer.alloc(0))]);
}

async function imageFolder(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'bake-images-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), await content);
  return folder(dir);
}

describe('images', () => {
  test('renders an image on its own line as a figure with its caption, size and lazy loading', async (t) => {
    const options = { folder: await imageFolder(t, { 'plot.svg': svg }) };
    const [figure] = (await parsed('![A plot](plot.svg "Shape of $d_{ff}$ in **FFN**.")\n', options)).intro;
    assert.deepEqual([figure.type, figure.line, figure.endLine], ['figure', 7, 7]);
    assert.equal(
      outline(figure.html),
      '<figure class="figure"><img src="plot.svg" alt="A plot" width="320" height="200" loading="lazy" decoding="async" data-src="plot.svg"><figcaption>Shape of $d_{ff}$ in <strong>FFN</strong>.</figcaption></figure>',
    );
  });

  test('sizes an image in pixels or percent and keeps the aspect ratio unless both sides are given', async (t) => {
    const options = { folder: await imageFolder(t, { 'plot.svg': svg }) };
    const cases = [
      ['{width=160px}', '160px', 'width="320" height="200"', { width: '160px' }],
      ['{width=50%}', '50%', 'width="320" height="200"', { width: '50%' }],
      ['{height=100px}', '160px', 'width="320" height="200"', { height: '100px' }],
      ['{height=20%}', '32%', 'width="320" height="200"', { height: '20%' }],
      ['{width=200px height=100px}', '200px', 'width="320" height="160"', { width: '200px', height: '100px' }],
    ];
    for (const [attributes, boxWidth, size, written] of cases) {
      const [figure] = (await parsed(`![](plot.svg)${attributes}\n`, options)).intro;
      const data = JSON.stringify(written).replaceAll('"', '&#x22;');
      assert.equal(figure.html, `<figure class="figure" style="width:${boxWidth}"><img src="plot.svg" alt="" ${size} loading="lazy" decoding="async" data-src="plot.svg" data-attributes="${data}"></figure>`, attributes);
    }
  });

  test('floats an image and starts the paragraph on the next line after it', async (t) => {
    const options = { folder: await imageFolder(t, { 'plot.svg': svg }) };
    const blocks = (await parsed('![ReLU](plot.svg){width=280px float=left}\nReLU is *zero* below 0.\nIt is linear above.\n', options)).intro;
    assert.deepEqual(
      blocks.map((block) => [block.type, block.line, block.endLine, block.html]),
      [
        ['figure', 7, 7, '<figure class="figure" data-float="left" style="width:280px"><img src="plot.svg" alt="ReLU" width="320" height="200" loading="lazy" decoding="async" data-src="plot.svg" data-attributes="{&#x22;width&#x22;:&#x22;280px&#x22;,&#x22;float&#x22;:&#x22;left&#x22;}"></figure>'],
        ['paragraph', 8, 9, '<p>ReLU is <em>zero</em> below 0.\nIt is linear above.</p>'],
      ],
    );
  });

  test('keeps an image inside text or a list as an inline image', async (t) => {
    const options = { folder: await imageFolder(t, { 'plot.svg': svg }) };
    const blocks = (await parsed('Curve ![](plot.svg){width=64px} here.\n\n- ![](plot.svg){width=64px}\n', options)).intro;
    assert.deepEqual(
      blocks.map((block) => block.html),
      [
        '<p>Curve <img src="plot.svg" alt="" width="320" height="200" loading="lazy" decoding="async" style="width:64px;height:auto" data-src="plot.svg" data-attributes="{&#x22;width&#x22;:&#x22;64px&#x22;}"> here.</p>',
        '<ul>\n<li><img src="plot.svg" alt="" width="320" height="200" loading="lazy" decoding="async" style="width:64px;height:auto" data-src="plot.svg" data-attributes="{&#x22;width&#x22;:&#x22;64px&#x22;}"></li>\n</ul>',
      ],
    );
  });

  test('publishes an AVIF image unchanged with its size', async (t) => {
    const avif = sharp({ create: { width: 48, height: 24, channels: 3, background: '#2a78d6' } }).avif().toBuffer();
    const options = { folder: await imageFolder(t, { 'photo.avif': avif }) };
    const structure = await parsed('![A photo](photo.avif)\n', options);
    assert.equal(structure.intro[0].html, '<figure class="figure"><img src="photo.avif" alt="A photo" width="48" height="24" loading="lazy" decoding="async" data-src="photo.avif"></figure>');
  });

  test('publishes raster images as WebP no wider than twice their largest display width', async (t) => {
    const options = { folder: await imageFolder(t, { 'wide.png': png(3000, 1500), 'photo.jpg': sharp({ create: { width: 900, height: 600, channels: 3, background: '#fff' } }).jpeg().toBuffer(), 'small.png': png(400, 200) }) };
    const article = await parsed('![](wide.png)\n\n![](photo.jpg){width=300px}\n\n![](small.png){width=200px}\n\n![](small.png){width=50%}\n', options);
    assert.deepEqual(
      article.intro.map((block) => /<img src="([^"]*)" alt="" width="(\d+)" height="(\d+)"/.exec(block.html).slice(1)),
      [
        ['wide.webp', '2680', '1340'],
        ['photo.webp', '600', '400'],
        ['small.webp', '400', '200'],
        ['small.webp', '400', '200'],
      ],
    );
  });

  test('publishes the original of an image when a link, a URL attribute such as src, href or poster, or a srcset address in raw HTML names its whole path', async (t) => {
    const references = {
      a1: '[original](./a1.png)',
      a2: '<a href="a2.png">original</a>',
      a3: '<IMG SRC=a3.png>',
      a4: '<img srcset="small.png 1x, a4.png 2x">',
      a5: '<video src="clip.mp4" poster="a5.png"></video>',
      a6: '<object data="a6.png"></object>',
      a7: '<picture><source srcset="a7.png"></picture>',
      b1: '<img src="xb1.png">',
      b2: '<img src="x.png" alt="b2.png">',
      b3: '<!-- b3.png -->',
    };
    const image = await png(40, 20);
    const body = Object.entries(references).map(([name, reference]) => `![](${name}.png)\n\n${reference}\n`).join('\n');
    const dir = createBlog(t, { 'bake.config.js': validConfig, 'content/posts/rope/index.md': article({ body }), ...Object.fromEntries(Object.keys(references).map((name) => [`content/posts/rope/${name}.png`, image])) });
    assert.equal(bake(dir, 'build').stderr, '');
    const published = readdirSync(join(dir, 'dist/2026-10/rope')).filter((name) => name.endsWith('.png'));
    assert.deepEqual(published.sort(), ['a1.png', 'a2.png', 'a3.png', 'a4.png', 'a5.png', 'a6.png', 'a7.png']);
  });

  test('shows the first image of an article in document order, inside sidenotes too, on its homepage card', async (t) => {
    const photo = await png(40, 20);
    const dir = createBlog(t, {
      'bake.config.js': validConfig,
      'content/posts/photo/index.md': article({ title: 'Photo', slug: 'photo', date: '2026-10-04', body: 'Text.\n\n![](photo.png)\n\n![](plot.svg)\n' }),
      'content/posts/photo/photo.png': photo,
      'content/posts/photo/plot.svg': svg,
      'content/posts/plot/index.md': article({ title: 'Plot', slug: 'plot', date: '2026-10-03', body: 'Text.\n\n![](plot.svg)\n\n![](photo.png)\n' }),
      'content/posts/plot/photo.png': photo,
      'content/posts/plot/plot.svg': svg,
      'content/posts/note/index.md': article({ title: 'Note', slug: 'note', date: '2026-10-02', body: 'A note[^n].\n\n![](photo.png)\n\n[^n]: ![](note.png)\n' }),
      'content/posts/note/photo.png': photo,
      'content/posts/note/note.png': photo,
      'content/posts/plain/index.md': article({ title: 'Plain', slug: 'plain', date: '2026-10-01', body: 'No images.\n' }),
    });
    assert.equal(bake(dir, 'build').stderr, '');
    const cards = readFileSync(join(dir, 'dist/index.html'), 'utf8').split('<a class="bk-card"').slice(1);
    assert.deepEqual(
      cards.map((card) => /<img src="([^"]*)"/.exec(card)?.[1] ?? null),
      ['2026-10/photo/photo.webp', '2026-10/plot/plot.svg', '2026-10/note/note.webp', null],
    );
  });

  test('reports wrong image attributes at their opening brace', async (t) => {
    const options = { folder: await imageFolder(t, { 'plot.svg': svg }) };
    const { errors } = await parse('![](plot.svg){width=wide}\n\n![](plot.svg){height=10em size=2}\n\n![](plot.svg){width=10px height=10%}\n\n![](plot.svg){float=center}\n\nText ![](plot.svg){float=left}\n\n![](plot.svg){width=0px}\n\n![](plot.svg){height=0%}\n', options);
    assert.deepEqual(errors, [
      'index.md:7:14 image width must be a positive number of pixels or a percentage, got "wide"; use :::{width=wide} around the image',
      'index.md:9:14 unknown attribute "size" on image',
      'index.md:9:14 image height must be a positive number of pixels or a percentage, got "10em", for example 560px or 70%',
      'index.md:11:14 image width and height must use the same unit',
      'index.md:13:14 float must be left or right, got "center"',
      'index.md:15:19 float only applies to an image that starts a paragraph',
      'index.md:17:14 image width must be a positive number of pixels or a percentage, got "0px", for example 560px or 70%',
      'index.md:19:14 image height must be a positive number of pixels or a percentage, got "0%", for example 560px or 70%',
    ]);
  });

  test('reports images that are not files in the article folder or not images', async (t) => {
    const options = { folder: await imageFolder(t, { 'notes.png': 'not an image', 'plot.png': png(10, 10), 'plot.webp': png(10, 10), 'a.gif': png(10, 10), 'a.jpg': png(10, 10), 'huge.png': hugePng() }) };
    const { errors } = await parse('![](missing.svg)\n\n![](https://example.com/a.png)\n\n![](/images/a.png)\n\n![](../a.png)\n\n![](notes.png)\n\n![](plot.png)\n\n![](a.jpg)\n\n![](a.gif)\n\n![](huge.png)\n', options);
    assert.deepEqual(errors, [
      'index.md:7:1 image missing.svg is not a file in the article folder',
      'index.md:9:1 image https://example.com/a.png is not a file in the article folder',
      'index.md:11:1 image /images/a.png is not a file in the article folder',
      'index.md:13:1 image ../a.png is not a file in the article folder',
      'index.md:15:1 image notes.png is not a PNG, JPEG, GIF, WebP, AVIF or SVG file',
      'index.md:17:1 image plot.png is published as plot.webp, which is also a file in the article folder',
      'index.md:21:1 images a.jpg and a.gif are both published as a.webp',
      'index.md:23:1 image huge.png cannot be read: Input image exceeds pixel limit',
    ]);
  });
  test('gives a figure its written pixel width as the natural width and none without a size or with a percentage', async (t) => {
    const options = { folder: await imageFolder(t, { 'plot.svg': svg }) };
    const blocks = (await parsed('![](plot.svg)\n\n![](plot.svg){width=560px}\n\n![](plot.svg){width=70%}\n', options)).intro;
    assert.deepEqual(blocks.map((block) => block.naturalWidth), [undefined, '560px', undefined]);
  });
});
