import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { describe, test } from 'node:test';
import sharp from 'sharp';
import { folder, outline, parse, parsed } from './article.js';

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
      '<figure class="figure"><img src="plot.svg" alt="A plot" width="320" height="200" loading="lazy" decoding="async"><figcaption>Shape of $d_{ff}$ in <strong>FFN</strong>.</figcaption></figure>',
    );
  });

  test('sizes an image in pixels or percent and keeps the aspect ratio unless both sides are given', async (t) => {
    const options = { folder: await imageFolder(t, { 'plot.svg': svg }) };
    const cases = [
      ['{width=160px}', '160px', 'width="320" height="200"'],
      ['{width=50%}', '50%', 'width="320" height="200"'],
      ['{height=100px}', '160px', 'width="320" height="200"'],
      ['{height=20%}', '32%', 'width="320" height="200"'],
      ['{width=200px height=100px}', '200px', 'width="320" height="160"'],
    ];
    for (const [attributes, boxWidth, size] of cases) {
      const [figure] = (await parsed(`![](plot.svg)${attributes}\n`, options)).intro;
      assert.equal(figure.html, `<figure class="figure" style="width:${boxWidth}"><img src="plot.svg" alt="" ${size} loading="lazy" decoding="async"></figure>`, attributes);
    }
  });

  test('floats an image and starts the paragraph on the next line after it', async (t) => {
    const options = { folder: await imageFolder(t, { 'plot.svg': svg }) };
    const blocks = (await parsed('![ReLU](plot.svg){width=280px float=left}\nReLU is *zero* below 0.\nIt is linear above.\n', options)).intro;
    assert.deepEqual(
      blocks.map((block) => [block.type, block.line, block.endLine, block.html]),
      [
        ['figure', 7, 7, '<figure class="figure" data-float="left" style="width:280px"><img src="plot.svg" alt="ReLU" width="320" height="200" loading="lazy" decoding="async"></figure>'],
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
        '<p>Curve <img src="plot.svg" alt="" width="320" height="200" loading="lazy" decoding="async" style="width:64px;height:auto"> here.</p>',
        '<ul>\n<li><img src="plot.svg" alt="" width="320" height="200" loading="lazy" decoding="async" style="width:64px;height:auto"></li>\n</ul>',
      ],
    );
  });

  test('publishes raster images as WebP no wider than twice their largest display width', async (t) => {
    const options = { folder: await imageFolder(t, { 'wide.png': png(3000, 1500), 'photo.jpg': sharp({ create: { width: 900, height: 600, channels: 3, background: '#fff' } }).jpeg().toBuffer(), 'small.png': png(400, 200) }) };
    const article = await parsed('![](wide.png)\n\n![](photo.jpg){width=300px}\n\n![](small.png){width=200px}\n\n![](small.png){width=50%}\n', options);
    assert.deepEqual(article.images, [
      { source: 'wide.png', path: 'wide.webp', width: 2680, lossless: true, keepSource: false },
      { source: 'photo.jpg', path: 'photo.webp', width: 600, lossless: false, keepSource: false },
      { source: 'small.png', path: 'small.webp', width: 400, lossless: true, keepSource: false },
    ]);
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
  test('gives a figure its pixel width as the natural width and none for a percentage', async (t) => {
    const options = { folder: await imageFolder(t, { 'plot.svg': svg }) };
    const blocks = (await parsed('![](plot.svg)\n\n![](plot.svg){width=560px}\n\n![](plot.svg){width=70%}\n', options)).intro;
    assert.deepEqual(blocks.map((block) => block.naturalWidth), ['320px', '560px', undefined]);
  });
});
