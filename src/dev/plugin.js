import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatMessage } from '../format/index.js';
import { imageExtensions } from '../format/validate.js';
import { loadSite, renderPage } from '../site/index.js';
import { findPages } from '../site/pages.js';

export const bakeRoot = fileURLToPath(new URL('../..', import.meta.url));
const componentPrefix = '\0bake:component/';
const bakeStyles = ['base', 'blocks', 'layouts'].map((name) => `src/styles/${name}.css`);
const bakeScripts = ['src/client/sidenotes.js', 'src/dev/client.js'];

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function bakeUrl(path) {
  return `/@fs${join(bakeRoot, path)}`;
}

export function componentEntry(name) {
  return `/@id/__x00__${componentPrefix.slice(1)}${name}`;
}

function isInside(directory, path) {
  return path.startsWith(directory + sep);
}

function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function sendText(response, status, text, type = 'text/plain') {
  response.statusCode = status;
  response.setHeader('content-type', `${type}; charset=utf-8`);
  response.end(text);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestError(400, 'Request body is not valid JSON');
  }
}

function requireStrings(body, fields) {
  for (const field of fields) {
    if (typeof body?.[field] !== 'string') throw new RequestError(400, `Missing string field ${field}`);
  }
}

function splitHref(href) {
  const hash = href.indexOf('#');
  const path = (hash === -1 ? href : href.slice(0, hash)).split('?')[0];
  const fragment = hash === -1 ? '' : decodeURIComponent(href.slice(hash + 1));
  return { path, fragment };
}

function chromeOf(result) {
  return result.html.replace(result.rendered.mathDefs, '').replace(result.rendered.html, '');
}

export function bakeDev({ root }) {
  const content = join(root, 'content');
  const configFile = join(root, 'bake.config.js');
  const rendered = new Map();
  const savedHashes = new Map();
  const statuses = new Map();
  const chromes = new Map();
  const openUrls = new Set();
  let site;
  let server;
  let queue = Promise.resolve();

  function serialize(task) {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  }

  function report(messages) {
    for (const message of messages) console.error(formatMessage(message));
  }

  async function reloadSite() {
    site = await loadSite(root);
    rendered.clear();
    report(site.messages);
  }

  async function reloadPages() {
    const { pages, messages } = await findPages(root);
    site = { ...site, pages };
    report(messages);
  }

  function pageAt(url) {
    return site.pages.find((page) => page.url === url);
  }

  function pageAssets({ page, components }) {
    const theme = site.themes[page.theme ?? site.config.theme];
    return {
      styles: [...bakeStyles.map(bakeUrl), ...(theme ? [`/${theme}`] : [])],
      scripts: [...bakeScripts.map(bakeUrl), ...components.filter((name) => site.components[name]).map(componentEntry)],
    };
  }

  async function renderEntry(entry) {
    const hash = sha256(await readFile(join(root, entry.path)));
    const cached = rendered.get(entry.path);
    if (cached?.hash === hash) return cached.result;
    const result = await renderPage(site, entry.path, { assets: pageAssets });
    rendered.set(entry.path, { hash, result });
    report(result.messages);
    return result;
  }

  async function brokenLinks(entry, result) {
    const messages = [];
    for (const { href, line, column } of result.rendered.links) {
      const { path, fragment } = splitHref(href);
      const target = path === '' ? entry : pageAt(path);
      if (!target) {
        messages.push({ path: entry.path, line, column, text: `Link points to a missing page ${href}` });
        continue;
      }
      if (fragment === '') continue;
      const ids = target === entry ? result.rendered.ids : (await renderEntry(target)).rendered.ids;
      if (!ids.includes(fragment)) messages.push({ path: entry.path, line, column, text: `Link points to a missing id ${href}` });
    }
    return messages;
  }

  async function pageState(entry) {
    const result = await renderEntry(entry);
    if (result.html === null) return { result, chromeChanged: false };
    const status = { errors: result.messages, links: await brokenLinks(entry, result) };
    statuses.set(entry.url, status);
    const chrome = chromeOf(result);
    const chromeChanged = chromes.get(entry.url) !== chrome;
    chromes.set(entry.url, chrome);
    return { result, status, chromeChanged };
  }

  async function sendPage(entry, { chrome = false } = {}) {
    const { result, status, chromeChanged } = await pageState(entry);
    if (result.html === null) return;
    const { html, toc, mathDefs } = result.rendered;
    server.ws.send('bake:page', { url: entry.url, html, toc, mathDefs, chrome: chrome || chromeChanged, ...status });
  }

  async function servePage(entry, request, response) {
    const { result } = await pageState(entry);
    if (result.html === null) {
      sendText(response, 500, result.messages.map(formatMessage).join('\n') + '\n');
      return;
    }
    sendText(response, 200, await server.transformIndexHtml(entry.url, result.html, request.originalUrl), 'text/html');
  }

  async function pageFile(page) {
    if (!isInside(content, resolve(content, `.${page}`))) throw new RequestError(403, 'Path is outside content/');
    const entry = pageAt(page);
    if (!entry) throw new RequestError(404, `No page at ${page}`);
    const file = join(root, entry.path);
    if (!isInside(await realpath(content), await realpath(file))) throw new RequestError(403, 'Path is outside content/');
    return { entry, file };
  }

  async function source(url) {
    const page = url.searchParams.get('page');
    if (page === null) throw new RequestError(400, 'Missing query parameter page');
    const { entry, file } = await pageFile(page);
    const bytes = await readFile(file);
    return { path: entry.path, markdown: bytes.toString('utf8'), hash: sha256(bytes) };
  }

  async function save(body) {
    requireStrings(body, ['page', 'markdown', 'hash']);
    const { entry, file } = await pageFile(body.page);
    const current = await readFile(file);
    const currentHash = sha256(current);
    if (currentHash !== body.hash) throw Object.assign(new RequestError(409, 'File changed on disk'), { body: { markdown: current.toString('utf8'), hash: currentHash } });
    const bytes = Buffer.from(body.markdown, 'utf8');
    const hash = sha256(bytes);
    savedHashes.set(entry.path, hash);
    await writeFile(file, bytes);
    return { hash };
  }

  async function asset(body) {
    requireStrings(body, ['page', 'data', 'ext']);
    if (!imageExtensions.includes(`.${body.ext}`)) throw new RequestError(400, `Unsupported image extension ${body.ext}`);
    const { file: pagePath } = await pageFile(body.page);
    const bytes = Buffer.from(body.data, 'base64');
    const name = `${sha256(bytes).slice(0, 8)}.${body.ext}`;
    const directory = join(dirname(pagePath), 'assets');
    if (!isInside(content, join(directory, name))) throw new RequestError(403, 'Path is outside content/');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, name), bytes, { flag: 'wx' }).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
    return { path: `./assets/${name}` };
  }

  const endpoints = {
    'GET /__bake/source': (request, url) => source(url),
    'POST /__bake/save': async (request) => serialize(async () => save(await readJson(request))),
    'POST /__bake/asset': async (request) => serialize(async () => asset(await readJson(request))),
  };

  async function handleApi(request, response, url) {
    const endpoint = endpoints[`${request.method} ${url.pathname}`];
    if (!endpoint) {
      sendJson(response, 404, { error: `Unknown endpoint ${request.method} ${url.pathname}` });
      return;
    }
    try {
      sendJson(response, 200, await endpoint(request, url));
    } catch (error) {
      if (!(error instanceof RequestError)) throw error;
      sendJson(response, error.status, error.body ?? { error: error.message });
    }
  }

  function assetFile(pathname) {
    const owners = site.pages.filter((page) => page.url !== null && pathname.startsWith(`${page.url}assets/`));
    const owner = owners.sort((a, b) => b.url.length - a.url.length)[0];
    if (!owner) return null;
    return `/${posix.join(dirname(owner.path).split(sep).join('/'), pathname.slice(owner.url.length))}`;
  }

  async function handleRequest(request, response, next) {
    const url = new URL(request.originalUrl ?? request.url, 'http://localhost');
    if (url.pathname.startsWith('/__bake/')) return handleApi(request, response, url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return next();
    const entry = pageAt(url.pathname);
    if (entry) return servePage(entry, request, response);
    const file = assetFile(url.pathname);
    if (file) {
      request.url = file + url.search;
      return next();
    }
    if (url.pathname.endsWith('/')) return sendText(response, 404, `No page at ${url.pathname}\n`);
    return next();
  }

  async function handleMarkdown(event, file) {
    await reloadPages();
    if (event === 'unlink') return;
    const path = relative(root, file);
    const entry = site.pages.find((page) => page.path === path);
    if (!entry?.url) return;
    if (savedHashes.get(path) === sha256(await readFile(file))) return;
    await sendPage(entry);
  }

  async function handleConfig() {
    await reloadSite();
    for (const url of openUrls) {
      const entry = pageAt(url);
      if (entry) await sendPage(entry, { chrome: true });
    }
  }

  function handleFile(event, file) {
    if (file === configFile) return serialize(handleConfig);
    if (isInside(content, file) && file.endsWith('.md')) return serialize(() => handleMarkdown(event, file));
    if (Object.values(site.components).some(({ path }) => join(root, path) === file)) return serialize(reloadSite);
    return undefined;
  }

  return {
    name: 'bake-dev',
    async configureServer(devServer) {
      server = devServer;
      await reloadSite();
      server.watcher.add(configFile);
      server.watcher.on('all', (event, file) => {
        handleFile(event, file)?.catch((error) => server.config.logger.error(error.stack));
      });
      server.ws.on('bake:open', ({ url }) => openUrls.add(url));
      server.middlewares.use((request, response, next) => handleRequest(request, response, next).catch(next));
    },
    resolveId(id) {
      if (id.startsWith(componentPrefix)) return id;
      return undefined;
    },
    load(id) {
      if (!id.startsWith(componentPrefix)) return undefined;
      const name = id.slice(componentPrefix.length);
      const component = site.components[name];
      if (!component) return undefined;
      const file = JSON.stringify(`/${component.path.split(sep).join('/')}`);
      return `import Component from ${file};
import { defineComponent } from ${JSON.stringify(bakeUrl('src/dev/component.js'))};
const replace = defineComponent(${JSON.stringify(name)}, Component);
if (import.meta.hot) import.meta.hot.accept(${file}, (module) => module && replace(module.default));
`;
    },
    transformIndexHtml(html, context) {
      const status = statuses.get(context.path);
      if (!status) return undefined;
      const children = JSON.stringify(status).replaceAll('<', '\\u003c');
      return [{ tag: 'script', attrs: { type: 'application/json', id: 'bake-status' }, children, injectTo: 'head' }];
    },
  };
}
