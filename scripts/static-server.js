import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve, sep } from 'node:path';
import { contentType } from '../src/build/content-types.js';

export async function serveStatic(dir) {
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
      response.writeHead(404, { 'content-type': contentType(notFound) });
      createReadStream(notFound).pipe(response);
      return;
    }
    response.writeHead(200, { 'content-type': contentType(path) });
    createReadStream(path).pipe(response);
  });
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
