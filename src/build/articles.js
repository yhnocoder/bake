import { join, posix } from 'node:path';
import { COMPONENTS_DIR } from '../components/read.js';
import { readFrontMatter } from '../config/front-matter.js';
import { readArticle } from '../markdown/article.js';
import { IMAGE_FORMATS, readImage } from '../render/images.js';
import { errorAt } from '../shared/report.js';
import { articleUrl } from '../shared/urls.js';
import { listFiles } from './files.js';

export const POSTS_DIR = 'content/posts';

export function findArticles(root) {
  const files = listFiles(join(root, POSTS_DIR), (name) => !name.startsWith('.'));
  const dirs = files.filter((file) => posix.basename(file) === 'index.md').map((file) => posix.dirname(file));
  return dirs.map((dir) => {
    const prefix = dir === '.' ? '' : `${dir}/`;
    const nested = dirs.filter((other) => other !== dir && (prefix === '' || other.startsWith(prefix))).map((other) => `${other}/`);
    return {
      file: posix.join(POSTS_DIR, prefix, 'index.md'),
      dir: posix.join(POSTS_DIR, dir),
      files: files
        .filter((file) => file.startsWith(prefix) && file !== `${prefix}index.md` && !file.startsWith(`${prefix}${COMPONENTS_DIR}/`) && !nested.some((other) => file.startsWith(other)))
        .map((file) => file.slice(prefix.length)),
    };
  });
}

export async function readArticles(site, found, errors) {
  const articles = [];
  for (const article of found) articles.push(await articleOf(site, article));
  errors.push(...articles.flatMap((article) => article.errors));
  return articles;
}

// why: bake build publishes no draft, so the problems of a draft that is half written do not keep the other articles from being published
export function publishedArticles(site, articles, errors) {
  if (!site.drafts) {
    const folders = articles.filter((article) => article.draft).map((article) => `${article.dir}/`);
    const kept = errors.filter((error) => !folders.some((folder) => error.file.startsWith(folder)));
    errors.splice(0, errors.length, ...kept);
  }
  return articles.filter((article) => article.url !== null && (site.drafts || !article.draft));
}

// An article depends on the values of the settings it reads, so a change of bake.config.js or of a component that leaves them as they were keeps it.
function articleOf(site, found) {
  return site.memo.get(`article ${found.file}`, { found, settings: site.settings, unsaved: site.unsaved.get(found.file) ?? null }, async (files) => {
    const article = files.value((context) => context.found);
    const rules = files.value((context) => context.settings.rules);
    const errors = [];
    const source = files.value((context) => context.unsaved) ?? files.read(join(files.root, article.file), 'utf8');
    const frontMatter = readFrontMatter(article.file, source, { ...rules, files: article.files }, errors);
    const fields = frontMatter?.fields ?? null;
    const url = fields?.slug !== undefined && fields?.date !== undefined ? articleUrl(fields.date, fields.slug) : null;
    const folder = { files: article.files, read: (file) => files.read(join(files.root, article.dir, file)) };
    const themeName = fields?.theme ?? rules.theme;
    const settings = {
      folder,
      url,
      get theme() {
        return files.value((context) => context.settings.markdown.get(themeName));
      },
      get preamble() {
        return files.value((context) => context.settings.preamble);
      },
      components: { get: (name) => files.value((context) => context.settings.components.get(name)) },
    };
    const document = fields?.page === undefined ? await readArticle(article.file, source, errors, settings) : null;
    const positions = frontMatter?.positions ?? {};
    const options = frontMatter?.options ?? {};
    const cover = fields?.cover === undefined ? undefined : await readCover(folder.read(fields.cover), fields.cover, article.file, positions.cover, errors);
    const draft = fields?.draft === true;
    const page = { url, title: fields?.title ?? '', draft, article: document };
    return { ...article, source, fields, options, positions, url, draft, document, page, content: null, cover, errors, conversions: new Map() };
  });
}

async function readCover(content, cover, file, position, errors) {
  const image = await readImage(content);
  if (image.width !== undefined) return { format: image.format, width: image.width, height: image.height };
  const problem = image.error === undefined ? `must be a ${IMAGE_FORMATS} image` : `cannot be read: ${image.error}`;
  errors.push(errorAt(file, position, `cover ${JSON.stringify(cover)} ${problem}`));
  return undefined;
}
