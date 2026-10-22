import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { CONFIG_FILE, POSTS_DIR } from '../config/bake-config.js';
import { BUILD_DIRS } from './dist.js';
import { escapeMarkup } from '../shared/escape.js';
import { articleUrl } from '../shared/urls.js';

const EXAMPLE_SLUG = 'hello';
const PACKAGE_FILE = 'package.json';
const BAKE = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

export function newBlog(folder, { date, language }) {
  const root = resolve(folder);
  const files = blogFiles(basename(root) || 'Blog', date, language);
  const blocking = blockingPaths(root, Object.keys(files));
  if (blocking.length > 0) return { error: `bake init: ${blocking.map((path) => join(folder, path)).join(', ')} already ${blocking.length === 1 ? 'exists' : 'exist'}; run bake init in a new or empty folder` };
  const packageFile = join(root, PACKAGE_FILE);
  const existing = statSync(packageFile, { throwIfNoEntry: false }) === undefined ? {} : readPackage(packageFile);
  if (existing === null) return { error: `bake init: ${join(folder, PACKAGE_FILE)} is not valid JSON` };
  try {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content, { flag: 'wx' });
    }
    writeFileSync(packageFile, `${JSON.stringify(blogPackage(existing), null, 2)}\n`);
  } catch (error) {
    return { error: `bake init: cannot write ${join(folder, relative(root, error.path ?? root))}: ${error.code ?? error.message}` };
  }
  return { root, files: [...Object.keys(files), PACKAGE_FILE], url: articleUrl(date, EXAMPLE_SLUG) };
}

function readPackage(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

// An existing package.json, such as the one npm init writes, keeps its fields; bake.config.js is an ES module, so the type becomes module.
function blogPackage(existing) {
  const installed = existing.dependencies?.[BAKE.name] ?? existing.devDependencies?.[BAKE.name];
  return {
    ...existing,
    type: 'module',
    scripts: { dev: 'bake dev', build: 'bake build', ...existing.scripts },
    ...(installed === undefined && { devDependencies: { ...existing.devDependencies, [BAKE.name]: `^${BAKE.version}` } }),
  };
}

// Installs the packages of package.json and the Chromium that bake build draws the share images with.
export function installDependencies(root) {
  for (const args of [['install'], ['exec', '--no', '--', 'playwright', 'install', 'chromium']]) {
    // why: npm is npm.cmd on Windows, which Node starts only through a shell
    const result = spawnSync('npm', args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.status !== 0) return `bake init: npm ${args.join(' ')} failed${result.error ? `: ${result.error.message}` : ''}; the blog files are written, run it again in ${root}`;
  }
  return null;
}

function blockingPaths(root, files) {
  const blocking = new Set();
  const check = (path, folder) => {
    const stat = statSync(join(root, path), { throwIfNoEntry: false });
    if (stat !== undefined && (!folder || !stat.isDirectory())) blocking.add(path);
  };
  const existing = nearestExisting(root);
  if (!statSync(existing).isDirectory()) return [relative(root, existing) || '.'];
  for (const file of files) {
    const parts = file.split('/');
    for (let depth = 1; depth < parts.length; depth += 1) check(parts.slice(0, depth).join('/'), true);
    check(file, false);
  }
  return [...blocking];
}

function nearestExisting(path) {
  let current = path;
  while (statSync(current, { throwIfNoEntry: false }) === undefined) current = dirname(current);
  return current;
}

// Chinese for a system set to Chinese, English otherwise, the two languages whose labels Bake has.
export function systemLanguage() {
  return Intl.DateTimeFormat().resolvedOptions().locale.startsWith('zh') ? 'zh-CN' : 'en';
}

function blogFiles(name, date, language) {
  const text = language.startsWith('zh') ? FIRST_POST.zh : FIRST_POST.en;
  return {
    [CONFIG_FILE]: ['export default {', `  title: ${JSON.stringify(name)},`, `  language: ${JSON.stringify(language)},`, '};', ''].join('\n'),
    [`${POSTS_DIR}/${EXAMPLE_SLUG}/index.md`]: ['---', `title: ${text.title}`, `slug: ${EXAMPLE_SLUG}`, `date: ${date}`, `summary: ${text.summary}`, '---', '', ...text.body, ''].join('\n'),
    'public/favicon.svg': favicon(name),
    '.gitignore': [...['node_modules', ...BUILD_DIRS].map((dir) => `${dir}/`), ''].join('\n'),
    '.github/workflows/deploy.yml': DEPLOY_WORKFLOW,
  };
}

function favicon(name) {
  const initial = escapeMarkup([...name.trim()][0]?.toUpperCase() ?? 'B');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#985b57"/><text x="32" y="44" font-family="system-ui, sans-serif" font-size="36" font-weight="700" text-anchor="middle" fill="#fff">${initial}</text></svg>\n`;
}

const MATH = ['$$', '\\int_0^1 x^2 \\, dx = \\frac{1}{3}', '$$'];

const FIRST_POST = {
  en: {
    title: 'Hello',
    summary: 'The first post of this blog.',
    body: [
      'This post was created by `bake init`. Edit it, or create the next post with `bake new "Title of the post"`.[^drafts]',
      '',
      '[^drafts]: `bake new` creates a draft. `bake dev` shows drafts, and `bake build` publishes a post once `draft: true` is removed.',
      '',
      '## Math',
      '',
      'Inline math such as $e^{i\\pi} + 1 = 0$ and display math:',
      '',
      ...MATH,
    ],
  },
  zh: {
    title: '你好',
    summary: '这个博客的第一篇文章。',
    body: [
      '这篇文章由 `bake init` 创建。修改它，或者用 `bake new "文章标题" --slug article-slug` 写下一篇。[^drafts]',
      '',
      '[^drafts]: `bake new` 创建的是草稿。`bake dev` 会显示草稿，删掉 `draft: true` 之后 `bake build` 才会发布它。',
      '',
      '## 数学',
      '',
      '行内公式 $e^{i\\pi} + 1 = 0$，以及独立公式：',
      '',
      ...MATH,
    ],
  },
};

// GitHub Pages names the address of the site, a custom domain included, so the build takes it from there instead of bake.config.js.
const DEPLOY_WORKFLOW = `name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: playwright-\${{ hashFiles('package-lock.json') }}
      - run: npx playwright install --with-deps --only-shell chromium
      - id: pages
        uses: actions/configure-pages@v5
      - run: npx bake build --url "\${{ steps.pages.outputs.base_url }}"
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - id: deployment
        uses: actions/deploy-pages@v4
`;
