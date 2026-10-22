import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve, sep } from 'node:path';
import { createGzip } from 'node:zlib';
import { contentType } from '../shared/content-types.js';

const PORT_ATTEMPTS = 20;

// Serves a built site as GitHub Pages does: 404.html for a missing file, and a cache time for the hashed files in assets/.
export async function serveStatic(dir, { gzip = false, localhost = false, port = 0 } = {}) {
  const root = resolve(dir);
  const assets = join(root, 'assets');
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let path = resolve(join(root, pathname));
    if (statSync(path, { throwIfNoEntry: false })?.isDirectory()) path = join(path, 'index.html');
    if (!path.startsWith(`${root}${sep}`) || !statSync(path, { throwIfNoEntry: false })?.isFile()) {
      const notFound = join(root, '404.html');
      if (!statSync(notFound, { throwIfNoEntry: false })?.isFile()) {
        response.writeHead(404).end();
        return;
      }
      send(request, response, 404, notFound);
      return;
    }
    send(request, response, 200, path);
  });
  const send = (request, response, status, path) => {
    const type = contentType(path);
    const cache = path.startsWith(`${assets}${sep}`) ? { 'cache-control': 'max-age=600' } : {};
    if (gzip && compressible(type) && /\bgzip\b/.test(request.headers['accept-encoding'] ?? '')) {
      response.writeHead(status, { 'content-type': type, 'content-encoding': 'gzip', vary: 'accept-encoding', ...cache });
      createReadStream(path).pipe(createGzip()).pipe(response);
      return;
    }
    response.writeHead(status, { 'content-type': type, ...cache });
    createReadStream(path).pipe(response);
  };
  await listen(server, port);
  return {
    // why: the AI chat appears only at localhost
    origin: `http://${localhost ? 'localhost' : '127.0.0.1'}:${server.address().port}`,
    close: () =>
      new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      }),
  };
}

// A port in use moves to the next one, as in bake dev; port 0 takes any free port.
async function listen(server, port) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await new Promise((done, failed) => {
        server.once('error', failed);
        server.listen(port === 0 ? 0 : port + attempt, '127.0.0.1', () => {
          server.off('error', failed);
          done();
        });
      });
      return;
    } catch (error) {
      if (error.code !== 'EADDRINUSE' || port === 0 || attempt === PORT_ATTEMPTS - 1) throw error;
    }
  }
}

function compressible(type) {
  return /^(text\/|application\/(javascript|json|xml|rss\+xml)|image\/svg\+xml)/.test(type);
}
