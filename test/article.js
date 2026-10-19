import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { parseArticle } from '../src/markdown/article.js';
import { formatError, sortErrors } from '../src/report.js';

export const frontMatter = '---\ntitle: T\nslug: t\ndate: 2026-10-19\n---\n\n';

export async function parse(body, options) {
  const errors = [];
  const article = await parseArticle('index.md', frontMatter + body, errors, options);
  return { article, errors: sortErrors(errors).map(formatError) };
}

export async function parsed(body, options) {
  const { article, errors } = await parse(body, options);
  assert.deepEqual(errors, []);
  return article;
}

export async function html(body, options) {
  return outline((await parsed(body, options)).intro.map((block) => block.html).join('\n'));
}

export function outline(html) {
  return html
    .replace(/<mjx-container([^>]*)>[\s\S]*?<\/mjx-container>/g, (match, attributes) => {
      const delimiter = attributes.includes('display="true"') ? '$$' : '$';
      return `${delimiter}${/data-tex="([^"]*)"/.exec(attributes)[1]}${delimiter}`;
    })
    .replace(/<pre class="shiki bake"[^>]*?(?: data-language="([^"]*)")?><code>([\s\S]*?)<\/code><\/pre>/g, (match, language = '', code) => `\`\`\`${language}\n${code.replace(/<[^>]*>/g, '')}\n\`\`\``);
}

export function folder(path) {
  return { path, files: readdirSync(path) };
}
