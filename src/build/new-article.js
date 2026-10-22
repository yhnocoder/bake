import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { configNotFoundError, hasConfig } from '../config/bake-config.js';
import { slugProblem } from '../config/rules.js';
import { errorAt, fileStart, formatError } from '../shared/report.js';
import { POSTS_DIR } from './articles.js';
import { articleUrl } from '../shared/urls.js';

export function newArticle(root, path, date) {
  if (!hasConfig(root)) return { error: formatError(configNotFoundError()) };
  const segments = path.split('/').filter((segment) => segment !== '');
  if (path.startsWith('/') || segments.some((segment) => segment === '.' || segment === '..')) {
    return { error: `bake new: the path must be relative to ${POSTS_DIR}/ and stay inside it, got ${JSON.stringify(path)}` };
  }
  const slug = segments.at(-1);
  const problem = slugProblem('slug', slug);
  if (problem) return { error: `bake new: ${problem}; the slug is the last folder name of the path` };
  const file = [POSTS_DIR, ...segments, 'index.md'].join('/');
  if (existsSync(join(root, file))) return { error: formatError(errorAt(file, fileStart, 'already exists')) };
  mkdirSync(dirname(join(root, file)), { recursive: true });
  const frontMatter = stringify({ title: slug, slug, date, draft: true });
  writeFileSync(join(root, file), `---\n${frontMatter}---\n\n`, { flag: 'wx' });
  return { file, url: articleUrl(date, slug) };
}
