import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { contentType } from '../build/content-types.js';
import { escapeMarkup } from '../build/escape.js';
import { errorCount, formatError } from '../report.js';
import { missingPage } from './missing.js';
import { createPreview } from './preview.js';
import { watchBlog } from './watch.js';

export const DEFAULT_PORT = 4321;
const PORT_ATTEMPTS = 20;
const DEV_PREFIX = '/__bake/';
const CLIENT_FILES = { 'client.js': 'text/javascript; charset=utf-8', 'client.css': 'text/css; charset=utf-8' };

export async function startDevServer(blogRoot, { port = DEFAULT_PORT, print = console.log } = {}) {
  const root = resolve(blogRoot);
  const preview = createPreview(root);
  const serverId = randomUUID();
  const clients = new Set();
  let printedProblems = '';

  const printProblems = (problems) => {
    const lines = problems.map(formatError);
    const text = lines.join('\n');
    if (text === printedProblems) return;
    print(lines.length === 0 ? 'No problems' : [...lines, errorCount(lines.length)].join('\n'));
    printedProblems = text;
  };
  const report = (result) => {
    printProblems(result.problems);
    if (!result.applied) return;
    const updated = result.reload === 'all' ? ['every page'] : [...result.reload, ...result.refresh];
    if (updated.length > 0) print(`Updated ${updated.join(', ')}`);
  };
  const broadcast = (event, data) => {
    for (const client of clients) send(client, event, data);
  };

  printProblems((await preview.update()).problems);

  const server = createServer((request, response) => {
    respond(request, response).catch((error) => {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(error instanceof Error ? error.message : String(error));
    });
  });

  async function respond(request, response) {
    const { pathname } = new URL(request.url, 'http://localhost');
    if (pathname === `${DEV_PREFIX}events`) return openEvents(request, response);
    const clientFile = pathname.startsWith(DEV_PREFIX) ? pathname.slice(DEV_PREFIX.length) : null;
    if (clientFile !== null && Object.hasOwn(CLIENT_FILES, clientFile)) {
      response.writeHead(200, { 'content-type': CLIENT_FILES[clientFile], 'cache-control': 'no-store' });
      return response.end(readFileSync(join(import.meta.dirname, clientFile)));
    }
    let path;
    try {
      path = decodeURIComponent(pathname).slice(1);
    } catch {
      path = null;
    }
    const found = path === null ? null : preview.find(path === '' || path.endsWith('/') ? `${path}index.html` : path);
    if (found === null && path !== null && path !== '' && !path.endsWith('/') && preview.find(`${path}/index.html`) !== null) {
      response.writeHead(301, { location: `${pathname}/` });
      return response.end();
    }
    if (found === null) return sendHtml(response, 404, injectClient(missingPage(pathname, preview.listing()), { missing: true }));
    const { output, page } = found;
    const body = output.from === undefined ? await output.render() : readFileSync(output.from);
    if (extname(output.path) === '.html') return sendHtml(response, 200, injectClient(String(body), clientData(root, page)));
    response.writeHead(200, { 'content-type': contentType(output.path), 'cache-control': 'no-store' });
    response.end(body);
  }

  function openEvents(request, response) {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    send(response, 'hello', { id: serverId });
    send(response, 'problems', problemsData(preview.problems()));
    clients.add(response);
    request.on('close', () => clients.delete(response));
  }

  let waiting = [];
  let updating = null;
  const changed = (paths) => {
    waiting.push(...paths);
    updating ??= (async () => {
      while (waiting.length > 0) {
        const batch = [...new Set(waiting)];
        waiting = [];
        try {
          const result = await preview.update(batch);
          report(result);
          broadcast('problems', problemsData(result.problems));
          if (result.applied) broadcast('update', { reload: result.reload, refresh: result.refresh });
        } catch (error) {
          print(`bake dev could not update the preview: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      updating = null;
    })();
  };

  const listenedPort = await listen(server, port);
  let stop;
  const stopped = new Promise((done) => {
    stop = done;
  });
  const close = () => {
    stopWatching();
    for (const client of clients) client.end();
    clients.clear();
    server.closeAllConnections();
    return new Promise((done) => server.close(() => done()));
  };
  const stopWatching = watchBlog(root, changed, (error) => {
    close().then(() => stop(`bake dev: cannot watch ${root}: ${error.message}`));
  });
  const url = `http://localhost:${listenedPort}/`;
  if (listenedPort !== port && port !== 0) print(`Port ${port} is in use, using port ${listenedPort}`);
  print([`Serving the blog at ${url}`, ...networkAddresses().map((address) => `On the local network: http://${address}:${listenedPort}/`)].join('\n'));

  return {
    port: listenedPort,
    url,
    stopped,
    close,
  };
}

export function networkAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
}

async function listen(server, port) {
  const last = port === 0 ? 0 : port + PORT_ATTEMPTS - 1;
  for (let candidate = port; ; candidate += 1) {
    try {
      await new Promise((done, fail) => {
        server.once('error', fail);
        server.listen(candidate, () => {
          server.off('error', fail);
          done();
        });
      });
      return server.address().port;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      if (candidate >= last) throw new Error(`bake dev: ports ${port} to ${last} are all in use, choose another one with --port`);
    }
  }
}

function clientData(root, page) {
  if (page === null) return {};
  return { source: pathToFileURL(join(root, page.file)).pathname, file: page.file, outline: JSON.stringify(page.outline) };
}

function injectClient(html, data) {
  const attributes = Object.entries(data)
    .map(([name, value]) => (value === true ? ` data-${name}` : ` data-${name}="${escapeMarkup(value)}"`))
    .join('');
  const script = `<script src="${DEV_PREFIX}client.js" data-bake-dev${attributes}></script>`;
  const end = html.lastIndexOf('</body>');
  return end === -1 ? `${html}${script}` : `${html.slice(0, end)}${script}${html.slice(end)}`;
}

function sendHtml(response, status, html) {
  response.writeHead(status, { 'content-type': contentType('index.html'), 'cache-control': 'no-store' });
  response.end(html);
}

function problemsData(problems) {
  return problems.map((problem) => ({ position: `${problem.file}:${problem.line}:${problem.column}`, text: formatError(problem) }));
}

function send(response, event, data) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
