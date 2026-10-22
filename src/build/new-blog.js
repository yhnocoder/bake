import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { CONFIG_FILE } from '../config/bake-config.js';
import { POSTS_DIR } from './articles.js';
import { BUILD_DIRS } from './dist.js';
import { articleUrl } from '../shared/urls.js';

const EXAMPLE_SLUG = 'hello';

export function newBlog(folder, date) {
  const root = resolve(folder);
  const files = blogFiles(basename(root) || 'Blog', date);
  const blocking = blockingPaths(root, Object.keys(files));
  if (blocking.length > 0) return { error: `bake init: ${blocking.map((path) => join(folder, path)).join(', ')} already ${blocking.length === 1 ? 'exists' : 'exist'}; run bake init in a new or empty folder` };
  try {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content, { flag: 'wx' });
    }
  } catch (error) {
    return { error: `bake init: cannot write ${join(folder, relative(root, error.path ?? root))}: ${error.code ?? error.message}` };
  }
  return { root, files: Object.keys(files), url: articleUrl(date, EXAMPLE_SLUG) };
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

function blogFiles(name, date) {
  return {
    [CONFIG_FILE]: ['export default {', `  title: ${JSON.stringify(name)},`, "  url: 'https://example.github.io',", "  language: 'zh-CN',", '};', ''].join('\n'),
    [`${POSTS_DIR}/${EXAMPLE_SLUG}/index.md`]: [
      '---',
      'title: Hello',
      `slug: ${EXAMPLE_SLUG}`,
      `date: ${date}`,
      'summary: The first post of this blog.',
      '---',
      '',
      'This post was created by `bake init`. Edit it, or create the next post with `bake new <path>`.[^drafts]',
      '',
      '[^drafts]: `bake new` creates a draft. `bake dev` shows drafts, and `bake build` publishes a post once `draft: true` is removed.',
      '',
      '## Math',
      '',
      'Inline math such as $e^{i\\pi} + 1 = 0$ and display math:',
      '',
      '$$',
      '\\int_0^1 x^2 \\, dx = \\frac{1}{3}',
      '$$',
      '',
    ].join('\n'),
    '.gitignore': [...['node_modules', ...BUILD_DIRS].map((dir) => `${dir}/`), ''].join('\n'),
  };
}
