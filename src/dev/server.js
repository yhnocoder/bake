import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect, isIP, isIPv6 } from 'node:net';
import { networkInterfaces } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { contentType } from '../content-types.js';
import { escapeMarkup } from '../escape.js';
import { describeValue, errorCount, formatError } from '../report.js';
import { missingPage } from './missing.js';
import { rewriteSource, sourceVersion } from './params.js';
import { createPreview } from './preview.js';
import { watchBlog } from './watch.js';

const DEFAULT_PORT = 4321;
const DEFAULT_HOST = '127.0.0.1';
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::']);
const TOKEN_HEADER = 'x-bake-token';
const PORT_ATTEMPTS = 20;
const DEV_PREFIX = '/__bake/';
const MAX_REQUEST_BYTES = 1024 * 1024;
const CLIENT_DIR = join(import.meta.dirname, 'client');
const CLIENT_FILES = new Map([...readdirSync(CLIENT_DIR).map((file) => [file, join(CLIENT_DIR, file)]), ['controls.css', join(import.meta.dirname, '../kit/controls.css')]]);

export async function startDevServer(blogRoot, { port = DEFAULT_PORT, host = DEFAULT_HOST, print = console.log } = {}) {
  const root = resolve(blogRoot);
  const preview = createPreview(root);
  const serverId = randomUUID();
  const token = randomBytes(32).toString('base64url');
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

  const server = createServer((request, response) => {
    respond(request, response).catch((error) => {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(error instanceof Error ? error.message : String(error));
    });
  });

  async function respond(request, response) {
    const requestHost = hostName(request.headers.host);
    if (!allowedHost(requestHost, host)) {
      response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      return response.end(requestHost === null ? 'bake dev refuses requests without a Host header' : `bake dev refuses requests for the host ${requestHost}; open the page at localhost or at an IP address`);
    }
    const { pathname } = new URL(request.url, 'http://localhost');
    if (pathname === `${DEV_PREFIX}events`) return openEvents(request, response);
    if (pathname === `${DEV_PREFIX}params`) return answerParams(request, response);
    if (pathname === `${DEV_PREFIX}source`) return answerSource(request, response);
    if (pathname === `${DEV_PREFIX}articles`) return sendJson(response, 200, { articles: preview.listing() });
    if (pathname === `${DEV_PREFIX}blocks`) return answerBlocks(request, response);
    const clientFile = pathname.startsWith(DEV_PREFIX) ? pathname.slice(DEV_PREFIX.length) : null;
    if (clientFile !== null && CLIENT_FILES.has(clientFile)) {
      response.writeHead(200, { 'content-type': contentType(clientFile), 'cache-control': 'no-store' });
      return response.end(readFileSync(CLIENT_FILES.get(clientFile)));
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
    if (extname(output.path) === '.html') return sendHtml(response, 200, injectClient(String(body), clientData(root, page, token)));
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

  async function answerParams(request, response) {
    const body = await pageRequest(request, response, 'parameters');
    if (body === undefined) return;
    const [status, data] = changeParams(root, preview, body);
    sendJson(response, status, data);
  }

  async function answerSource(request, response) {
    const body = await pageRequest(request, response, 'text');
    if (body === undefined) return;
    const { file, text } = isPlainObject(body) ? body : {};
    if (typeof text !== 'string' && text !== null) return sendJson(response, 400, { error: 'text must be the unsaved text of the article, or null for the saved file' });
    const changedText = typeof file === 'string' ? preview.setUnsaved(file, text) : null;
    if (changedText === null) return sendJson(response, 404, { error: `${describeValue(file)} is not an article of the blog` });
    if (changedText) changed([file]);
    sendJson(response, 200, {});
  }

  function answerBlocks(request, response) {
    const file = new URL(request.url, 'http://localhost').searchParams.get('file');
    const blocks = preview.blocks(file);
    if (blocks === null) return sendJson(response, 404, { error: `${describeValue(file)} is not an article that bake dev has read` });
    sendJson(response, 200, { blocks });
  }

  async function pageRequest(request, response, what) {
    if (request.method !== 'POST') return sendJson(response, 405, { error: `send the ${what} with POST` });
    if (!sameToken(request.headers[TOKEN_HEADER], token)) return sendJson(response, 403, { error: 'the request does not carry the token of this bake dev run; reload the page' });
    if (!sameOrigin(request)) return sendJson(response, 403, { error: `${what} can only be sent from a page that bake dev serves` });
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) return sendJson(response, 415, { error: `send the ${what} as application/json` });
    try {
      return JSON.parse(await readBody(request));
    } catch (error) {
      return sendJson(response, 400, { error: `cannot read the request: ${error.message}` });
    }
  }

  let waiting = [];
  let updating = null;
  async function applyChanges() {
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
  }
  const changed = (paths) => {
    waiting.push(...paths);
    updating ??= applyChanges();
  };
  // why: a file written on disk replaces the unsaved text that the editor sent for it
  const saved = (paths) => {
    preview.dropUnsaved(paths);
    changed(paths);
  };

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
  // why: macOS reports changes only from a moment after fs.watch returns, so watching starts before the first build, which also catches a file saved during that build
  const stopWatching = watchBlog(root, saved, (error) => {
    close().then(() => stop(`bake dev: cannot watch ${root}: ${error.message}`));
  });
  let listenedPort;
  try {
    updating = preview.update();
    printProblems((await updating).problems);
    updating = waiting.length > 0 ? applyChanges() : null;
    listenedPort = await listen(server, port, host);
  } catch (error) {
    stopWatching();
    throw error;
  }
  const url = `http://${addressHost(host)}:${listenedPort}/`;
  if (listenedPort !== port && port !== 0) print(`Port ${port} is in use, using port ${listenedPort}`);
  const network = WILDCARD_HOSTS.has(host) ? networkAddresses().map((address) => `On the local network: http://${address}:${listenedPort}/`) : [];
  print([`Serving the blog at ${url}`, ...network].join('\n'));

  return {
    address: server.address().address,
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

function addressHost(host) {
  if (WILDCARD_HOSTS.has(host) || isLoopback(host)) return 'localhost';
  return isIPv6(host) ? `[${host}]` : host;
}

function isLoopback(host) {
  return host === 'localhost' || host === '::1' || host === '127.0.0.1';
}

export function hostName(header) {
  if (typeof header !== 'string' || header === '') return null;
  const match = /^\[([^\]]*)\](?::\d*)?$/.exec(header) ?? /^([^:]*)(?::\d*)?$/.exec(header);
  return (match === null ? header : match[1]).toLowerCase();
}

export function allowedHost(name, host) {
  if (name === null) return false;
  return name === 'localhost' || name.endsWith('.localhost') || isIP(name) !== 0 || name === host.toLowerCase();
}

function sameToken(sent, token) {
  if (typeof sent !== 'string') return false;
  const expected = Buffer.from(token);
  const actual = Buffer.from(sent);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function listen(server, port, host) {
  const last = port === 0 ? 0 : port + PORT_ATTEMPTS - 1;
  const printsLocalhost = addressHost(host) === 'localhost';
  for (let candidate = port; ; candidate += 1) {
    try {
      if (candidate === 0 || !printsLocalhost || !(await answersOnLocalhost(candidate))) {
        await new Promise((done, fail) => {
          server.once('error', fail);
          server.listen(candidate, host, () => {
            server.off('error', fail);
            done();
          });
        });
        return server.address().port;
      }
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
    }
    if (candidate >= last) throw new Error(`bake dev: ports ${port} to ${last} are all in use, choose another one with --port`);
  }
}

// why: the printed localhost address can reach another server on ::1 or on a wildcard address, and macOS lets 127.0.0.1 be bound next to a server on a wildcard address
async function answersOnLocalhost(port) {
  const answers = (address) =>
    new Promise((done) => {
      const socket = connect({ host: address, port });
      socket.once('connect', () => {
        socket.destroy();
        done(true);
      });
      socket.once('error', () => done(false));
    });
  return (await Promise.all(['127.0.0.1', '::1'].map(answers))).some(Boolean);
}

function clientData(root, page, token) {
  if (page === null) return {};
  return {
    source: pathToFileURL(join(root, page.file)).pathname,
    file: page.file,
    outline: JSON.stringify(page.outline),
    version: page.version,
    components: JSON.stringify(page.components),
    token,
  };
}

function changeParams(root, preview, body) {
  const { file, version, line, name, params, write } = isPlainObject(body) ? body : {};
  const page = typeof file === 'string' ? preview.page(file) : null;
  if (page === null) return [404, { error: `${describeValue(file)} is not an article that bake dev serves` }];
  const component = typeof name === 'string' ? preview.component(name) : null;
  if (component === null) return [400, { error: `unknown component ${describeValue(name)}` }];
  if (!isPlainObject(params)) return [400, { error: 'params must map each parameter name to its value' }];
  let source;
  try {
    source = readFileSync(join(root, file), 'utf8');
  } catch {
    source = null;
  }
  if (source === null || sourceVersion(source) !== version) return [409, { error: `${file} changed after this page was built; save it in your editor and try again` }];
  const result = rewriteSource(source, line, name, component.params, params, page.files);
  if (result.error !== undefined) return [400, { error: `${file}:${line} ${result.error}` }];
  if (write === true && result.source !== source) writeFileSync(join(root, file), result.source);
  return [200, { line: result.line, version: sourceVersion(write === true ? result.source : source) }];
}

function sameOrigin(request) {
  const { origin, host } = request.headers;
  if (origin === undefined) return true;
  try {
    return typeof host === 'string' && new URL(origin).host === host.toLowerCase();
  } catch {
    return false;
  }
}

function readBody(request) {
  return new Promise((done, fail) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        fail(new Error('the request is larger than 1 MB'));
        request.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    request.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
    request.on('error', fail);
  });
}

function sendJson(response, status, data) {
  response.writeHead(status, { 'content-type': contentType('data.json'), 'cache-control': 'no-store' });
  response.end(JSON.stringify(data));
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function injectClient(html, data) {
  const attributes = Object.entries(data)
    .map(([name, value]) => (value === true ? ` data-${name}` : ` data-${name}="${escapeMarkup(value)}"`))
    .join('');
  const script = `<script type="module" src="${DEV_PREFIX}client.js" data-bake-dev${attributes}></script>`;
  // why: a module script runs after parsing in document order, so it goes first in the head to see the regions before the deferred theme scripts insert nodes into them
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (head !== null) return `${html.slice(0, head.index + head[0].length)}${script}${html.slice(head.index + head[0].length)}`;
  const end = html.lastIndexOf('</body>');
  return end === -1 ? `${html}${script}` : `${html.slice(0, end)}${script}${html.slice(end)}`;
}

function sendHtml(response, status, html) {
  response.writeHead(status, {
    'content-type': contentType('index.html'),
    'cache-control': 'no-store',
    // why: the preview of the Bake extension shows the page in a VS Code webview, whose frames have these schemes
    'content-security-policy': "frame-ancestors 'self' vscode-webview: vscode-file:",
  });
  response.end(html);
}

function problemsData(problems) {
  return problems.map((problem) => ({
    file: problem.file,
    location: `${problem.line}:${problem.column}`,
    message: problem.message,
    position: `${problem.file}:${problem.line}:${problem.column}`,
    text: formatError(problem),
  }));
}

function send(response, event, data) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
