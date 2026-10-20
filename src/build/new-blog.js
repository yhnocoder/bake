import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { CONFIG_FILE } from '../config/bake-config.js';
import { POSTS_DIR } from './articles.js';
import { articleUrl } from './urls.js';

const EXAMPLE_SLUG = 'hello';

export function newBlog(folder, date) {
  const root = resolve(folder);
  const files = blogFiles(basename(root), date);
  const existing = Object.keys(files).filter((path) => existsSync(join(root, path)));
  if (existing.length > 0) return { error: `bake init: ${existing.map((path) => join(folder, path)).join(', ')} already ${existing.length === 1 ? 'exists' : 'exist'}; run bake init in a new or empty folder` };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content, { flag: 'wx' });
  }
  return { root, files: Object.keys(files), url: articleUrl(date, EXAMPLE_SLUG) };
}

function blogFiles(name, date) {
  return {
    [CONFIG_FILE]: ['export default {', `  title: '${name.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}',`, "  url: 'https://example.github.io',", "  language: 'zh-CN',", '};', ''].join('\n'),
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
    '.gitignore': ['node_modules/', 'dist/', '.dist-staging/', '.dist-previous/', ''].join('\n'),
  };
}
