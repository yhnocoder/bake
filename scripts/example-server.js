import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { loadSite, renderPage } from '../src/site/index.js';
import { createModuleLoader } from '../src/site/modules.js';

const root = resolve(import.meta.dirname, '..');
const example = 'examples/minimal';
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

async function renderExample() {
  const loader = await createModuleLoader(join(root, example));
  const site = await loadSite(join(root, example), { loader }).finally(() => loader.close());
  // why(#25): this server serves files without Vite, so components that import bake/runtime cannot load and are left undefined
  const definitions = Object.entries(site.components).map(
    ([name, { path }]) => `import('/${example}/${path}').then((module) => customElements.define('${name}', module.default), () => {});\n`,
  );
  const files = { '/components.js': definitions.join('') };
  const pages = {};
  const messages = [...site.messages];
  for (const { path, frontmatter } of site.pages) {
    const theme = site.themes[frontmatter.theme ?? site.config.theme];
    const assets = {
      styles: ['base', 'blocks', 'layouts'].map((name) => `/src/styles/${name}.css`).concat(`/${example}/${theme}`),
      scripts: ['/src/client/page.js', '/components.js'],
    };
    const result = await renderPage(site, path, { assets });
    messages.push(...result.messages);
    const url = `/${example}/${dirname(path)}/${basename(path, '.md')}.html`;
    files[url] = result.html;
    pages[basename(path, '.md')] = url;
  }
  return { files, pages, messages };
}

export async function serveExample() {
  const { files, pages, messages } = await renderExample();
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const file = resolve(join(root, path));
    let body = files[path];
    if (body === undefined && file.startsWith(root + sep)) body = await readFile(file).catch(() => undefined);
    if (body === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': contentTypes[extname(path)] ?? 'application/octet-stream' }).end(body);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    pages,
    messages,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}
