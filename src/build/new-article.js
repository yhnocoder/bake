import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { configNotFoundError, hasConfig } from '../config/bake-config.js';
import { slugProblem } from '../config/rules.js';
import { errorAt, fileStart, formatError } from '../shared/report.js';
import { POSTS_DIR } from './articles.js';
import { articleUrl } from '../shared/urls.js';

// The optional fields, as comments that the writer removes the # of.
const FIELD_HINTS = ['# summary: One sentence for the homepage card, the share image and the RSS feed', '# tags: []'];

// A path names the folder and the slug, such as 2026-10/rope; anything else is the title of the draft, whose slug comes from --slug or from its letters a to z and digits.
export function newArticle(root, input, { date, slug: givenSlug }) {
  if (!hasConfig(root)) return { error: formatError(configNotFoundError()) };
  const draft = givenSlug === undefined && isPath(input) ? fromPath(input) : fromTitle(input, givenSlug);
  if (draft.error) return draft;
  const { segments, slug, title } = draft;
  const problem = slugProblem('slug', slug);
  if (problem) return { error: `bake new: ${problem}${givenSlug === undefined ? '; the slug is the last folder name of the path' : ''}` };
  const file = [POSTS_DIR, ...segments, 'index.md'].join('/');
  if (existsSync(join(root, file))) return { error: formatError(errorAt(file, fileStart, 'already exists')) };
  mkdirSync(dirname(join(root, file)), { recursive: true });
  const frontMatter = stringify({ title, slug, date, draft: true });
  writeFileSync(join(root, file), `---\n${frontMatter}${FIELD_HINTS.join('\n')}\n---\n\n`, { flag: 'wx' });
  return { file, url: articleUrl(date, slug) };
}

function isPath(input) {
  return input.includes('/') || /^[a-z0-9-]+$/.test(input);
}

function fromPath(path) {
  const segments = path.split('/').filter((segment) => segment !== '');
  if (path.startsWith('/') || segments.some((segment) => segment === '.' || segment === '..')) {
    return { error: `bake new: the path must be relative to ${POSTS_DIR}/ and stay inside it, got ${JSON.stringify(path)}` };
  }
  const slug = segments.at(-1);
  return { segments, slug, title: slug };
}

function fromTitle(title, givenSlug) {
  if (title.trim() === '') return { error: 'bake new: the title is empty' };
  const slug = givenSlug ?? title.normalize('NFKD').toLowerCase().match(/[a-z0-9]+/g)?.join('-');
  if (slug === undefined) return { error: `bake new: the title ${JSON.stringify(title)} has no letters a to z or digits to make a slug of; give one with --slug <slug>` };
  return { segments: [slug], slug, title: title.trim() };
}
