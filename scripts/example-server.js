import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, relative, resolve, sep } from 'node:path';
import { build } from '../src/build/index.js';
import { loadSite } from '../src/site/index.js';
import { createModuleLoader } from '../src/site/modules.js';

const root = resolve(import.meta.dirname, '..');
const example = join(root, 'examples/minimal');
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

async function builtPages(directory) {
  const loader = await createModuleLoader(directory);
  const site = await loadSite(directory, { loader }).finally(() => loader.close());
  const pages = {};
  for (const { path, url, frontmatter } of site.pages) {
    if (url === null || frontmatter.draft === true) continue;
    const name = relative('content', path).slice(0, -'.md'.length).split(sep).join('-');
    pages[name] = site.config.base + url.slice(1);
  }
  return { pages, base: site.config.base };
}

export async function serveExample() {
  const directory = await mkdtemp(join(tmpdir(), 'bake-example-'));
  await cp(example, directory, { recursive: true });
  const { errors: messages } = await build(directory, { out: 'dist' });
  const dist = join(directory, 'dist');
  const { pages, base } = await builtPages(directory);
  const fileIn = async (directory, path) => {
    const file = resolve(join(directory, path, path.endsWith('/') ? 'index.html' : ''));
    const body = file.startsWith(directory + sep) ? await readFile(file).catch(() => undefined) : undefined;
    return body === undefined ? undefined : { file, body };
  };
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const found = (path.startsWith(base) ? await fileIn(dist, path.slice(base.length - 1)) : undefined) ?? (await fileIn(root, path));
    if (found === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': contentTypes[extname(found.file)] ?? 'application/octet-stream' }).end(found.body);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    pages,
    messages,
    close: async () => {
      server.closeAllConnections();
      server.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
