import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { build } from '../src/build/index.js';
import { pageSections } from '../src/build/sections.js';

const root = join(import.meta.dirname, '..');
const cli = join(root, 'src/cli.js');
const blogs = [];

function blog(files = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'bake-build-'));
  blogs.push(directory);
  cpSync(join(root, 'examples/minimal'), directory, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), content);
  }
  return directory;
}

function bake(cwd, ...args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function article(slug, body, extra = '') {
  return `---\ntitle: 文章 ${slug}\nslug: ${slug}\n${extra}---\n\n${body}\n`;
}

function files(directory, prefix = '') {
  return readdirSync(join(directory, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? files(directory, path) : [path];
  });
}

function read(directory, path) {
  return readFileSync(join(directory, path), 'utf8');
}

function matching(list, pattern) {
  const found = list.filter((path) => pattern.test(path));
  assert.equal(found.length, 1, `${pattern} matches ${found.join(', ')}`);
  return found[0];
}

async function buildBlog(directory) {
  const result = await build(directory, { out: 'dist' });
  assert.deepEqual(result.errors, []);
  return join(directory, 'dist');
}

function solidImage(width, height, color) {
  return sharp({ create: { width, height, channels: 4, background: color } });
}

after(() => {
  for (const directory of blogs) rmSync(directory, { recursive: true, force: true });
});

describe('输出目录', () => {
  test('每页的 index.html 和 sections.json，assets 下的组件、CSS、图片，site.json', async () => {
    const dist = await buildBlog(blog());
    const list = files(dist);
    for (const page of ['features', 'paper', 'bento']) {
      assert.ok(list.includes(`${page}/index.html`));
      assert.ok(list.includes(`${page}/sections.json`));
    }
    matching(list, /^assets\/components\/demo-plot\.[\w-]+\.js$/);
    matching(list, /^assets\/client\/page\.[\w-]+\.js$/);
    matching(list, /^assets\/bake\.[\w-]+\.css$/);
    matching(list, /^assets\/themes\/default\.[\w-]+\.css$/);
    matching(list, /^assets\/features\/relu\.[0-9a-f]{4}\.webp$/);
    matching(list, /^assets\/features\/neuron\.[0-9a-f]{4}\.svg$/);
    assert.ok(list.includes('site.json'));
    assert.ok(!list.some((path) => path.startsWith('.vite')));
    const css = read(dist, matching(list, /^assets\/bake\.[\w-]+\.css$/));
    assert.ok(css.includes('box-sizing') && css.includes('.lede') && !css.includes('@import'));
  });

  test('成功时替换已有的输出目录', async () => {
    const directory = blog({ 'dist/old.txt': 'old' });
    const result = bake(directory, 'build');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'Built 5 pages to dist/\n');
    assert.ok(!existsSync(join(directory, 'dist/old.txt')));
    assert.ok(existsSync(join(directory, 'dist/features/index.html')));
    assert.deepEqual(
      readdirSync(directory).filter((name) => name.startsWith('dist')),
      ['dist'],
    );
  });

  test('--out 改变输出目录和输出文字', () => {
    const directory = blog();
    const result = bake(directory, 'build', '--out', 'public/site');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'Built 5 pages to public/site/\n');
    assert.ok(existsSync(join(directory, 'public/site/paper/index.html')));
  });

  test('首页写成输出目录下的 index.html', async () => {
    const dist = await buildBlog(blog({ 'content/index.md': article('/', '首页。') }));
    assert.ok(read(dist, 'index.html').includes('首页。'));
    assert.ok(existsSync(join(dist, 'sections.json')));
  });

  test('多余的参数输出用法并以 1 退出', () => {
    const result = bake(blog(), 'build', '--port', '1');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^Usage:/);
  });
});

describe('组件与脚本', () => {
  test('页面只引用自己用到的组件，组件入口用文件名注册', async () => {
    const dist = await buildBlog(blog());
    const list = files(dist);
    const plot = matching(list, /^assets\/components\/demo-plot\.[\w-]+\.js$/);
    const client = matching(list, /^assets\/client\/page\.[\w-]+\.js$/);
    const features = read(dist, 'features/index.html');
    const paper = read(dist, 'paper/index.html');
    assert.ok(features.includes(`<script type="module" src="/${client}"></script>`));
    assert.ok(features.includes(`<script type="module" src="/${plot}"></script>`));
    assert.ok(paper.includes(`<script type="module" src="/${client}"></script>`));
    assert.ok(!paper.includes('demo-plot.'));
    assert.ok(read(dist, plot).includes("customElements.define(`demo-plot`"));
  });

  test('组件共用的代码拆成共享 chunk', async () => {
    const shared = 'export const label = (text) => `[${text}]`;\n';
    const component = (name) =>
      `import { label } from './lib/label.js';\nexport default class extends HTMLElement {\n  connectedCallback() {\n    this.textContent = label('${name}');\n  }\n}\n`;
    const dist = await buildBlog(
      blog({
        'components/lib/label.js': shared,
        'components/first-box.js': component('first'),
        'components/second-box.js': component('second'),
        'content/boxes.md': article('boxes', '::first-box\n\n::second-box'),
      }),
    );
    const list = files(dist);
    const chunk = matching(list, /^assets\/chunks\/label\.[\w-]+\.js$/);
    const chunkName = chunk.split('/').at(-1);
    for (const name of ['first-box', 'second-box']) {
      assert.ok(read(dist, matching(list, new RegExp(`^assets/components/${name}\\.[\\w-]+\\.js$`))).includes(chunkName));
    }
    const boxes = read(dist, 'boxes/index.html');
    assert.ok(boxes.includes('first-box.') && boxes.includes('second-box.') && !boxes.includes('demo-plot.'));
  });

  test('打包错误按行列输出，不写入输出目录', () => {
    const directory = blog({
      'dist/old.txt': 'old',
      'components/lazy-box.js': "export default class extends HTMLElement {\n  connectedCallback() {\n    import('./lib/broken.js');\n  }\n}\n",
      'components/lib/broken.js': 'export const a = 1;\nconst = 2;\n',
      'content/lazy.md': article('lazy', '::lazy-box'),
    });
    const result = bake(directory, 'build');
    assert.equal(result.status, 1);
    assert.equal(result.stderr, 'components/lib/broken.js:2:7 [PARSE_ERROR] Unexpected token\n1 error, dist/ was not written\n');
    assert.deepEqual(
      readdirSync(directory).filter((name) => name.startsWith('dist')),
      ['dist'],
    );
    assert.deepEqual(files(join(directory, 'dist')), ['old.txt']);
  });

  test('配置文件有语法错误时报错，不渲染页面', () => {
    const directory = blog();
    writeFileSync(join(directory, 'bake.config.js'), "export default { {\n  title: 't',\n};\n");
    const result = bake(directory, 'build');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^bake\.config\.js:1:1 Cannot load bake\.config\.js: Failed to parse source[^\n]*\n1 error, dist\/ was not written\n$/);
  });

  test('配置的主题不存在时报错', () => {
    const directory = blog();
    writeFileSync(join(directory, 'bake.config.js'), "export default { title: 't', theme: 'missing', math: { macros: { R: '\\\\mathbb{R}' } } };\n");
    const result = bake(directory, 'build');
    assert.equal(result.status, 1);
    assert.equal(result.stderr, 'bake.config.js:1:1 Unknown theme missing\n1 error, dist/ was not written\n');
  });
});

describe('图片', () => {
  const image = (name, extra = '') => `![${name}](./assets/${name}${extra})`;

  async function imageBlog() {
    const directory = blog({ 'content/topic/media.md': article('topic/media', ['wide.png', 'photo.jpg', 'small.webp', 'moving.gif', 'shape.svg'].map((name) => image(name)).join('\n\n')) });
    const assets = join(directory, 'content/topic/assets');
    mkdirSync(assets, { recursive: true });
    await solidImage(2000, 1000, 'red').png().toFile(join(assets, 'wide.png'));
    await solidImage(300, 200, 'green').jpeg().toFile(join(assets, 'photo.jpg'));
    await solidImage(120, 90, 'blue').webp().toFile(join(assets, 'small.webp'));
    const frames = await Promise.all(['red', 'blue'].map((color) => solidImage(30, 20, color).png().toBuffer()));
    await sharp(frames, { join: { animated: true } }).gif().toFile(join(assets, 'moving.gif'));
    writeFileSync(join(assets, 'shape.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 40" width="50" height="40"><rect width="50" height="40"/></svg>\n');
    return { directory, assets };
  }

  test('PNG 和 JPEG 转成 WebP，宽度上限 1600px，GIF、SVG 与未超宽的 WebP 原样复制', async () => {
    const { directory, assets } = await imageBlog();
    const dist = await buildBlog(directory);
    const list = files(dist);
    const wide = matching(list, /^assets\/topic\/media\/wide\.[0-9a-f]{4}\.webp$/);
    assert.deepEqual(await sharp(join(dist, wide)).metadata().then(({ format, width, height }) => ({ format, width, height })), { format: 'webp', width: 1600, height: 800 });
    const photo = matching(list, /^assets\/topic\/media\/photo\.[0-9a-f]{4}\.webp$/);
    assert.equal((await sharp(join(dist, photo)).metadata()).format, 'webp');
    for (const name of ['small.webp', 'moving.gif', 'shape.svg']) {
      const [stem, extension] = name.split('.');
      const output = matching(list, new RegExp(`^assets/topic/media/${stem}\\.[0-9a-f]{4}\\.${extension}$`));
      assert.deepEqual(readFileSync(join(dist, output)), readFileSync(join(assets, name)));
    }
    const html = read(dist, 'topic/media/index.html');
    const imgs = [...html.matchAll(/<img [^>]*>/g)].map(([tag]) => tag);
    assert.deepEqual(imgs, [
      `<img src="/${wide}" alt="wide.png" width="1600" height="800" loading="lazy">`,
      `<img src="/${photo}" alt="photo.jpg" width="300" height="200" loading="lazy">`,
      `<img src="/${matching(list, /small\./)}" alt="small.webp" width="120" height="90" loading="lazy">`,
      `<img src="/${matching(list, /moving\./)}" alt="moving.gif" width="30" height="20" loading="lazy">`,
      `<img src="/${matching(list, /shape\./)}" alt="shape.svg" width="50" height="40" loading="lazy">`,
    ]);
  });

  test('文件名的哈希是文件内容 SHA-256 的前 4 位，文章里的尺寸保留在 style', async () => {
    const dist = await buildBlog(blog());
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(readFileSync(join(root, 'examples/minimal/content/assets/relu.png'))).digest('hex').slice(0, 4);
    const html = read(dist, 'features/index.html');
    assert.ok(html.includes(`<img src="/assets/features/relu.${hash}.webp" alt="ReLU 函数的图像" style="width: 240px" width="480" height="320" loading="lazy">`));
  });

  test('同一个文件被两页使用时按各自的 slug 输出，外部地址不处理', async () => {
    const directory = blog({ 'content/other.md': article('other', '![](./assets/relu.png)\n\n![](https://example.com/a.png)') });
    const dist = await buildBlog(directory);
    const list = files(dist);
    matching(list, /^assets\/other\/relu\.[0-9a-f]{4}\.webp$/);
    matching(list, /^assets\/features\/relu\.[0-9a-f]{4}\.webp$/);
    assert.ok(read(dist, 'other/index.html').includes('<img src="https://example.com/a.png" alt="">'));
  });

  test('图片不存在时报错', () => {
    const directory = blog({ 'content/missing.md': article('missing', '正文。\n\n![](./assets/none.png)') });
    const result = bake(directory, 'build');
    assert.equal(result.status, 1);
    assert.equal(result.stderr, 'content/missing.md:8:1 Image not found ./assets/none.png\n1 error, dist/ was not written\n');
  });
});

describe('sections.json', () => {
  test('标题范围到下一个同级或更高级标题之前，块范围是带 id 的段落', () => {
    const html = [
      '<div class="lede"><p>导语。</p></div>',
      '<h2 id="a">A</h2>',
      '<p>a 的正文。</p>',
      '<h3 id="b">B</h3>',
      '<p id="def">定义。</p>',
      '<demo-plot class="component"></demo-plot>',
      '<h4>没有 id</h4>',
      '<h2 id="c">C</h2>',
      '<div class="callout"><p id="inner">块里的段落。</p></div>',
    ].join('');
    assert.deepEqual(pageSections({ title: '标题', html }), {
      title: '标题',
      lede: '<div class="lede"><p>导语。</p></div>',
      sections: {
        a: {
          kind: 'heading',
          html: '<h2 id="a">A</h2><p>a 的正文。</p><h3 id="b">B</h3><p id="def">定义。</p><demo-plot class="component"></demo-plot><h4>没有 id</h4>',
          components: ['demo-plot'],
        },
        b: {
          kind: 'heading',
          html: '<h3 id="b">B</h3><p id="def">定义。</p><demo-plot class="component"></demo-plot><h4>没有 id</h4>',
          components: ['demo-plot'],
        },
        c: { kind: 'heading', html: '<h2 id="c">C</h2><div class="callout"><p id="inner">块里的段落。</p></div>', components: [] },
        def: { kind: 'block', html: '<p id="def">定义。</p>', components: [] },
        inner: { kind: 'block', html: '<p id="inner">块里的段落。</p>', components: [] },
      },
    });
  });

  test('只含图片的块是 figure，也有块范围', () => {
    const html = '<figure class="image" id="fig"><img src="a.webp" alt="图"><figcaption>图</figcaption></figure><figure id="other"></figure>';
    assert.deepEqual(pageSections({ title: 't', html }).sections, {
      fig: { kind: 'block', html: '<figure class="image" id="fig"><img src="a.webp" alt="图"><figcaption>图</figcaption></figure>', components: [] },
    });
  });

  test('没有导语时为空字符串', () => {
    assert.deepEqual(pageSections({ title: 't', html: '<p>正文。</p>' }), { title: 't', lede: '', sections: {} });
  });

  test('构建写出的 sections.json', async () => {
    const dist = await buildBlog(blog());
    const sections = JSON.parse(read(dist, 'features/sections.json'));
    assert.equal(sections.title, 'bake 的全部写法');
    assert.match(sections.lede, /^<div class="lede"/);
    assert.equal(sections.sections['chain-rule-def'].kind, 'block');
    assert.deepEqual(sections.sections.components.components, ['demo-plot']);
    assert.match(sections.sections.links.html, /^<h2 id="links">/);
    assert.ok(sections.sections.links.html.includes('href="/features/#chain-rule"'));
  });
});

describe('base 前缀', () => {
  test('站内链接、资源和图片地址加上 base', async () => {
    const directory = blog();
    writeFileSync(join(directory, 'bake.config.js'), "export default { title: 'bake minimal', theme: 'default', base: '/blog/', math: { macros: { R: '\\\\mathbb{R}' } } };\n");
    const dist = await buildBlog(directory);
    const html = read(dist, 'features/index.html');
    assert.ok(html.includes('href="/blog/features/#chain-rule"'));
    assert.ok(html.includes('<a class="anchor" href="#chain-rule"'));
    assert.match(html, /<link rel="stylesheet" href="\/blog\/assets\/bake\.[\w-]+\.css">/);
    assert.match(html, /<script type="module" src="\/blog\/assets\/components\/demo-plot\.[\w-]+\.js">/);
    assert.match(html, /<img src="\/blog\/assets\/features\/relu\.[0-9a-f]{4}\.webp"/);
    assert.ok(JSON.parse(read(dist, 'features/sections.json')).sections.links.html.includes('href="/blog/features/#chain-rule"'));
  });
});

describe('草稿', () => {
  test('草稿页面不输出，site.json 中也没有', async () => {
    const dist = await buildBlog(blog({ 'content/draft.md': article('draft', '草稿。', 'draft: true\n') }));
    assert.ok(!existsSync(join(dist, 'draft')));
    const site = JSON.parse(read(dist, 'site.json'));
    assert.deepEqual(
      site.pages.map((page) => page.url),
      ['/bento/', '/extending/', '/features/', '/', '/paper/'],
    );
  });

  test('链接指向草稿页面时报错', () => {
    const directory = blog({ 'content/draft.md': article('draft', '草稿。', 'draft: true\n'), 'content/link.md': article('link', '[草稿](/draft)') });
    const result = bake(directory, 'build');
    assert.equal(result.status, 1);
    assert.equal(result.stderr, 'content/link.md:6:1 Link points to a missing page /draft/\n1 error, dist/ was not written\n');
  });
});

describe('站内链接', () => {
  test('断开的链接：错误行、汇总行、退出码，已有输出目录不变', () => {
    const directory = blog({ 'dist/old.txt': 'old' });
    writeFileSync(
      join(directory, 'content/broken.md'),
      article('broken', '[页面](/nope) 和 [标题](/features#nope)。\n\n[本页](#missing) [存在](#here) [块](/features#chain-rule-def)\n\n## 这里 {#here}'),
    );
    const result = bake(directory, 'build');
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(
      result.stderr,
      [
        'content/broken.md:6:1 Link points to a missing page /nope/',
        'content/broken.md:6:15 Link points to a missing id /features/#nope',
        'content/broken.md:8:1 Link points to a missing id #missing',
        '3 errors, dist/ was not written',
        '',
      ].join('\n'),
    );
    assert.deepEqual(files(join(directory, 'dist')), ['old.txt']);
    assert.deepEqual(
      readdirSync(directory).filter((name) => name.startsWith('dist')),
      ['dist'],
    );
  });

  test('带查询参数的站内链接按地址和 id 检查', async () => {
    const directory = blog({ 'content/query.md': article('query', '[带参数](/features?x=1#chain-rule) [本页](?tab=2)') });
    const dist = await buildBlog(directory);
    assert.ok(read(dist, 'query/index.html').includes('href="/features/?x=1#chain-rule"'));
  });

  test('渲染错误与链接错误一起输出', () => {
    const directory = blog({ 'content/bad.md': article('bad', ':::callot\n内容\n:::\n\n[x](/nope)') });
    const result = bake(directory, 'build');
    assert.equal(result.status, 1);
    assert.equal(
      result.stderr,
      ['content/bad.md:6:1 Unknown directive :::callot', 'content/bad.md:10:1 Link points to a missing page /nope/', '2 errors, dist/ was not written', ''].join('\n'),
    );
  });
});

describe('渲染缓存', () => {
  function cacheEntries(directory) {
    const cache = join(directory, 'node_modules/.cache/bake');
    return readdirSync(cache).map((name) => join(cache, name));
  }

  test('第二次构建时未修改的文章使用缓存，修改的文章重新渲染', async () => {
    const directory = blog();
    await buildBlog(directory);
    const entries = cacheEntries(directory);
    assert.equal(entries.length, 5);
    const paperEntry = entries.find((file) => JSON.parse(readFileSync(file, 'utf8')).page.slug === 'paper');
    const cached = JSON.parse(readFileSync(paperEntry, 'utf8'));
    cached.html = cached.html.replace('梯度下降', '缓存里的文字');
    writeFileSync(paperEntry, JSON.stringify(cached));
    const featuresPath = join(directory, 'content/features.md');
    writeFileSync(featuresPath, readFileSync(featuresPath, 'utf8').replace('梯度指向函数值', '修改后的梯度指向函数值'));
    const dist = await buildBlog(directory);
    assert.ok(read(dist, 'paper/index.html').includes('缓存里的文字'));
    assert.ok(read(dist, 'features/index.html').includes('修改后的梯度指向函数值'));
    assert.equal(cacheEntries(directory).length, 5);
  });

  test('构建成功后删除这次没有用到的缓存文件', async () => {
    const directory = blog();
    await buildBlog(directory);
    const stale = join(directory, 'node_modules/.cache/bake/stale.json');
    writeFileSync(stale, '{}');
    rmSync(join(directory, 'content/bento.md'));
    await buildBlog(directory);
    assert.equal(existsSync(stale), false);
    assert.equal(cacheEntries(directory).length, 4);
  });

  test('blocks/ 或 layouts/ 中（包括子目录）的文件变化后全部重新渲染', async () => {
    const extensions = { blocks: "export default { name: 'extra', form: 'text' };\n", layouts: "export default () => '<article><!--bake:article--></article>';\n" };
    for (const directoryName of ['blocks', 'layouts']) {
      const directory = blog({ [`${directoryName}/extra.js`]: extensions[directoryName] });
      await buildBlog(directory);
      const before = new Set(cacheEntries(directory));
      mkdirSync(join(directory, directoryName, 'lib'));
      writeFileSync(join(directory, directoryName, 'lib/helper.js'), 'export default {};\n');
      await buildBlog(directory);
      const after = cacheEntries(directory);
      assert.equal(after.length, 5);
      assert.ok(after.every((file) => !before.has(file)), directoryName);
    }
  });

  test('只修改组件中 properties 以外的代码时使用缓存', async () => {
    const directory = blog();
    await buildBlog(directory);
    const before = cacheEntries(directory).sort();
    const component = join(directory, 'components/demo-plot.js');
    writeFileSync(component, `${readFileSync(component, 'utf8')}\nexport const unused = 1;\n`);
    await buildBlog(directory);
    assert.deepEqual(cacheEntries(directory).sort(), before);
  });

  test('缓存文件损坏时重新渲染', async () => {
    const directory = blog();
    await buildBlog(directory);
    for (const file of cacheEntries(directory)) writeFileSync(file, '{');
    const dist = await buildBlog(directory);
    assert.ok(read(dist, 'paper/index.html').includes('梯度下降'));
  });
});

describe('bake new', () => {
  test('新建文章，创建目录，输出可以被 bake format 保持不变', () => {
    const directory = blog();
    const result = bake(directory, 'new', 'hello/world');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'Created content/hello/world.md\n');
    assert.equal(read(directory, 'content/hello/world.md'), '---\ntitle: world\nslug: hello/world\n---\n');
    const formatted = bake(directory, 'format', 'content/hello');
    assert.equal(formatted.stdout, 'No files to rewrite\n');
  });

  test('只看起来像其他类型的标题加引号', () => {
    const directory = blog();
    assert.equal(bake(directory, 'new', '2026').status, 0);
    assert.equal(read(directory, 'content/2026.md'), '---\ntitle: "2026"\nslug: "2026"\n---\n');
  });

  test('文件已存在时报错', () => {
    const directory = blog();
    assert.equal(bake(directory, 'new', 'post').status, 0);
    writeFileSync(join(directory, 'content/post.md'), 'kept');
    const result = bake(directory, 'new', 'post');
    assert.equal(result.status, 1);
    assert.equal(result.stderr, 'content/post.md already exists\n');
    assert.equal(read(directory, 'content/post.md'), 'kept');
  });

  test('路径不符合 slug 格式时报错', () => {
    const directory = blog();
    for (const path of ['Hello', 'a//b', '/', '../x']) {
      const result = bake(directory, 'new', path);
      assert.equal(result.status, 1, path);
      assert.match(result.stderr, new RegExp(`^Invalid path ${path.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}: `));
    }
    assert.ok(!existsSync(join(directory, 'content/Hello.md')));
  });

  test('新建的文章可以直接构建', () => {
    const directory = blog();
    bake(directory, 'new', 'hello/world');
    const result = bake(directory, 'build');
    assert.equal(result.status, 0, result.stderr);
    assert.ok(read(directory, 'dist/hello/world/index.html').includes('<title>world · bake minimal</title>'));
  });
});

describe('构建后的组件', () => {
  test('修改 properties 中的属性时调用 attributeChangedCallback', async () => {
    const probe = [
      'export default class ProbeBox extends HTMLElement {',
      "  static properties = { stepSize: { label: '步长', type: 'number', default: 1 } };",
      '  attributeChangedCallback(name, previous, value) {',
      "    this.dataset.changed = `${name}=${value}`;",
      '  }',
      '}',
      '',
    ].join('\n');
    const directory = blog({ 'components/probe-box.js': probe, 'content/probe.md': article('probe', '::probe-box{stepSize=2}') });
    const dist = await buildBlog(directory);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.route('http://bake.test/**', (route) => {
        const path = new URL(route.request().url()).pathname;
        route.fulfill({ path: join(dist, path.endsWith('/') ? `${path}index.html` : path) });
      });
      await page.goto('http://bake.test/probe/');
      const changed = await page.evaluate(async () => {
        await customElements.whenDefined('probe-box');
        const element = document.querySelector('probe-box');
        element.setAttribute('stepsize', '3');
        return element.dataset.changed;
      });
      assert.equal(changed, 'stepsize=3');
    } finally {
      await browser.close();
    }
  });
});

describe('扩展', () => {
  test('examples/minimal 的首页和 extending 页面构建成功，使用博客的版式、主题、块类型和组件', async () => {
    const dist = await buildBlog(blog());
    const list = files(dist);
    const home = read(dist, 'index.html');
    const extending = read(dist, 'extending/index.html');
    assert.match(home, /<page-list class="component" data-md="::page-list"><\/page-list>/);
    assert.ok(home.includes(`src="/${matching(list, /^assets\/components\/page-list\.[\w-]+\.js$/)}"`));
    assert.match(extending, /<p class="note-series">bake 示例<\/p><h1>博客自己的扩展<\/h1>/);
    assert.match(extending, /<span class="math-shape matrix" data-md=":shape\[W\]\{kind=matrix\}">W<\/span>/);
    assert.match(extending, /<div class="theorem" data-name="定理" data-md="[^"]*"><p>链式法则<\/p>/);
    assert.ok(extending.includes(`href="/${matching(list, /^assets\/themes\/warm\.[\w-]+\.css$/)}"`));
    assert.ok(extending.includes(`src="/${matching(list, /^assets\/components\/wave-figure\.[\w-]+\.js$/)}"`));
    const warm = read(dist, matching(list, /^assets\/themes\/warm\.[\w-]+\.css$/));
    assert.ok(warm.includes('.math-shape') && !warm.includes('@import'));
  });

  test('扩展有错误时只输出扩展错误和汇总行，以 1 退出，输出目录不变', () => {
    const directory = blog({ 'dist/old.txt': 'old', 'components/plot.js': 'export default class extends HTMLElement {}\n', 'content/broken.md': article('broken', ':::callot\n内容。\n:::') });
    const result = bake(directory, 'build');
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'components/plot.js:1:1 Component file name must be lowercase letters, digits and "-", and contain at least one "-"\n1 error, dist/ was not written\n');
    assert.deepEqual(files(join(directory, 'dist')), ['old.txt']);
  });
});
