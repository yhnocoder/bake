import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import sharp from 'sharp';
import { createSite, updateSite } from '../src/build/site.js';
import { formatError } from '../src/report.js';
import { bake, createBlog, readTree, writeFiles } from './blog.js';

const builtIn = join(import.meta.dirname, '../src/chat/pets');

function config(pet) {
  return `export default {\n  title: 'Test Blog',\n  url: 'https://example.com',\n  language: 'en',\n  chat: { pet: ${JSON.stringify(pet)} },\n};\n`;
}

function sheet(width, height, format = 'png') {
  return sharp({ create: { width, height, channels: 4, background: { r: 200, g: 120, b: 40, alpha: 0.5 } } })
    [format]()
    .toBuffer();
}

async function petFiles(dir) {
  const site = createSite(dir);
  const result = await updateSite(site);
  return { errors: result.errors.map(formatError), files: Object.fromEntries(result.siteFiles.filter((file) => file.path.startsWith('_bake/pet/')).map((file) => [file.path, file.render()])) };
}

async function serveFiles(t, files) {
  const server = createServer((request, response) => {
    const body = files[request.url];
    if (body === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200).end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

describe('chat pets', () => {
  test('publishes the built-in CRT Monitor with its first frame, its credit and its license when bake.config.js names no pet', async (t) => {
    const dir = createBlog(t, { 'bake.config.js': "export default { title: 'Test Blog', url: 'https://example.com', language: 'en' };\n" });
    assert.equal(bake(dir, 'build').stderr, '');
    const tree = readTree(join(dir, 'dist'));
    assert.deepEqual(JSON.parse(tree['_bake/pet/pet.json']), { displayName: 'CRT Monitor', spritesheetPath: 'spritesheet.webp', credit: { author: 'wxy', license: 'CC BY 4.0', href: 'LICENSE.txt' } });
    assert.deepEqual(tree['_bake/pet/spritesheet.webp'], readFileSync(join(builtIn, 'crt-monitor/spritesheet.webp')));
    assert.deepEqual(tree['_bake/pet/LICENSE.txt'], readFileSync(join(builtIn, 'crt-monitor/LICENSE')));
    const frame = await sharp(tree['_bake/pet/frame.webp']).metadata();
    assert.deepEqual([frame.format, frame.width, frame.height], ['webp', 192, 208]);
    assert.ok(tree['_bake/pet/frame.webp'].length < 20000, `the first frame has ${tree['_bake/pet/frame.webp'].length} bytes`);
  });

  test('publishes the built-in Miso when bake.config.js names it', async (t) => {
    const dir = createBlog(t, { 'bake.config.js': config('miso') });
    const { errors, files } = await petFiles(dir);
    assert.deepEqual(errors, []);
    assert.deepEqual(JSON.parse(files['_bake/pet/pet.json']), { displayName: 'Miso', spritesheetPath: 'spritesheet.webp', credit: { author: 'gaerae (PlayPets)', license: 'MIT', href: 'LICENSE.txt' } });
    assert.match(files['_bake/pet/LICENSE.txt'].toString(), /Copyright \(c\) 2026 gaerae/);
  });

  test('reads a pet from a folder of the blog, ignores the other fields of pet.json and crops a sheet of 11 rows to 9', async (t) => {
    const dir = createBlog(t, {
      'bake.config.js': config('pets/bun'),
      'pets/bun/pet.json': JSON.stringify({ id: 'bun', displayName: ' Bun ', description: 'A bun.', spriteVersionNumber: 2, spritesheetPath: 'art/sheet.png', script: 'alert(1)' }),
    });
    writeFiles(dir, { 'pets/bun/art/sheet.png': await sheet(1536, 2288) });
    const { errors, files } = await petFiles(dir);
    assert.deepEqual(errors, []);
    assert.deepEqual(JSON.parse(files['_bake/pet/pet.json']), { displayName: 'Bun', spritesheetPath: 'spritesheet.webp' });
    const published = await sharp(files['_bake/pet/spritesheet.webp']).metadata();
    assert.deepEqual([published.format, published.width, published.height], ['webp', 1536, 1872]);
    assert.equal(files['_bake/pet/LICENSE.txt'], undefined);
  });

  test('reports a sheet of another size with its actual size, and every other problem of a pet folder at its file', async (t) => {
    const cases = [
      { files: { 'pets/bun/pet.json': '{"displayName":"Bun","spritesheetPath":"sheet.png"}' }, sheet: [1000, 500], error: 'pets/bun/sheet.png:1:1 the spritesheet is 1000x500 pixels, a pet spritesheet must be 1536x1872 or 1536x2288' },
      { files: { 'pets/bun/pet.json': '{"displayName":"Bun","spritesheetPath":"sheet.png"}', 'pets/bun/sheet.png': 'not an image' }, error: 'pets/bun/sheet.png:1:1 the spritesheet is not a PNG or WebP image' },
      { files: { 'pets/bun/pet.json': '{"displayName":"Bun"' }, error: /^pets\/bun\/pet\.json:1:1 pet\.json is not valid JSON: / },
      { files: { 'pets/bun/pet.json': '{"spritesheetPath":"sheet.png"}' }, error: 'pets/bun/pet.json:1:1 pet.json must have a non-empty displayName' },
      { files: { 'pets/bun/pet.json': '{"displayName":"Bun","spritesheetPath":"../secret.png"}' }, error: 'pets/bun/pet.json:1:1 spritesheetPath "../secret.png" does not name a file in the pet folder' },
      { files: { 'pets/bun/readme.txt': 'no pet.json' }, error: 'bake.config.js:5:16 chat.pet: pets/bun/pet.json does not exist' },
      { files: {}, error: 'bake.config.js:5:16 chat.pet: the folder pets/bun does not exist' },
    ];
    for (const { files, sheet: size, error } of cases) {
      const dir = createBlog(t, { 'bake.config.js': config('pets/bun'), ...files });
      if (size !== undefined) writeFiles(dir, { 'pets/bun/sheet.png': await sheet(...size) });
      const { errors } = await petFiles(dir);
      assert.equal(errors.length, 1, errors.join('\n'));
      if (typeof error === 'string') assert.equal(errors[0], error);
      else assert.match(errors[0], error);
    }
  });

  test('rejects a chat.pet that is not a built-in name, a folder in the blog or an http address', async (t) => {
    for (const [pet, message] of [
      [3, 'chat.pet must be "crt-monitor", "miso", a folder in the blog or the http or https URL of a pet.json, got 3'],
      ['../pets', 'chat.pet must be a folder inside the blog, got "../pets"'],
      ['ftp://example.com/pet.json', 'chat.pet must be an http or https URL of a pet.json, got "ftp://example.com/pet.json"'],
    ]) {
      const dir = createBlog(t, { 'bake.config.js': config(pet) });
      const result = bake(dir, 'build');
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(`^bake\\.config\\.js:5:16 ${message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\n`));
    }
  });

  test('downloads a pet from an address at build time and reports an address that fails, that is too large or whose sheet has the wrong size', async (t) => {
    const good = await sheet(1536, 1872, 'webp');
    const base = await serveFiles(t, {
      '/bun/pet.json': '{"displayName":"Bun","spritesheetPath":"sheet.webp"}',
      '/bun/sheet.webp': good,
      '/big/pet.json': '{"displayName":"Big","spritesheetPath":"sheet.png"}',
      '/big/sheet.png': Buffer.alloc(5 * 1024 * 1024 + 1),
      '/wrong/pet.json': '{"displayName":"Wrong","spritesheetPath":"sheet.png"}',
      '/wrong/sheet.png': await sheet(192, 208),
    });
    const dir = createBlog(t, { 'bake.config.js': config(`${base}/bun/pet.json`) });
    const { errors, files } = await petFiles(dir);
    assert.deepEqual(errors, []);
    assert.deepEqual(JSON.parse(files['_bake/pet/pet.json']), { displayName: 'Bun', spritesheetPath: 'spritesheet.webp' });
    assert.deepEqual(files['_bake/pet/spritesheet.webp'], good);
    for (const [path, message] of [
      ['/missing/pet.json', `cannot download ${base}/missing/pet.json: the server answered 404`],
      ['/big/pet.json', `${base}/big/sheet.png is larger than 5 MB`],
      ['/wrong/pet.json', `${base}/wrong/sheet.png: the spritesheet is 192x208 pixels, a pet spritesheet must be 1536x1872 or 1536x2288`],
    ]) {
      const failing = createBlog(t, { 'bake.config.js': config(`${base}${path}`) });
      assert.deepEqual((await petFiles(failing)).errors, [`bake.config.js:5:16 chat.pet: ${message}`]);
    }
  });

  test('reads a pet folder again in bake dev when one of its files changes', async (t) => {
    const dir = createBlog(t, { 'bake.config.js': config('pets/bun'), 'pets/bun/pet.json': '{"displayName":"Bun","spritesheetPath":"sheet.png"}' });
    writeFiles(dir, { 'pets/bun/sheet.png': await sheet(1536, 1872) });
    const site = createSite(dir, { drafts: true });
    const first = await updateSite(site);
    assert.equal(JSON.parse(first.siteFiles.find((file) => file.path === '_bake/pet/pet.json').render()).displayName, 'Bun');
    writeFiles(dir, { 'pets/bun/pet.json': '{"displayName":"Roll","spritesheetPath":"sheet.png"}' });
    const second = await updateSite(site, ['pets/bun/pet.json']);
    assert.equal(JSON.parse(second.siteFiles.find((file) => file.path === '_bake/pet/pet.json').render()).displayName, 'Roll');
  });
});
