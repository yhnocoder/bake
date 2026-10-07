import { resolve } from 'node:path';
import { loadSite, renderPage } from '../../src/site/index.js';
import { createModuleLoader } from '../../src/site/modules.js';

const root = resolve(process.argv[2]);
const loader = await createModuleLoader(root);
const site = await loadSite(root, { loader }).finally(() => loader.close());
const assets = { styles: [], scripts: [] };
const layouts = {
  'without <article>': ({ html }) => `<main>${html}</main>`,
  'two <article>': ({ html }) => `<article>${html}</article><article></article>`,
  'content outside <article>': ({ html }) => `<article></article>${html}`,
};
let failed = false;
for (const [name, render] of Object.entries(layouts)) {
  const testSite = { ...site, layouts: { ...site.layouts, essay: { ...site.layouts.essay, render } } };
  const { html, messages } = await renderPage(testSite, 'content/features.md', { assets });
  console.log(`${name}: html=${html === null ? 'null' : 'written'}`);
  for (const { path, line, column, text } of messages) console.log(`  ${path}:${line}:${column} ${text}`);
  if (html !== null || messages.length !== 1) failed = true;
}
const { html, messages } = await renderPage(site, 'content/features.md', { assets });
console.log(`built-in essay: html=${html === null ? 'null' : 'written'}, ${messages.length} messages`);
if (html === null || messages.length > 0) failed = true;
process.exitCode = failed ? 1 : 0;
