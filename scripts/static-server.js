import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve, sep } from 'node:path';
import { createGzip } from 'node:zlib';
import { contentType } from '../src/build/content-types.js';

export async function serveStatic(dir, { gzip = false } = {}) {
  const root = resolve(dir);
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
    if (gzip && compressible(type) && /\bgzip\b/.test(request.headers['accept-encoding'] ?? '')) {
      response.writeHead(status, { 'content-type': type, 'content-encoding': 'gzip', vary: 'accept-encoding' });
      createReadStream(path).pipe(createGzip()).pipe(response);
      return;
    }
    response.writeHead(status, { 'content-type': type });
    createReadStream(path).pipe(response);
  };
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      }),
  };
}

function compressible(type) {
  return /^(text\/|application\/(javascript|json|xml|rss\+xml)|image\/svg\+xml)/.test(type);
}
