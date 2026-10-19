import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const TYPES = {
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.xml': 'application/xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export async function serve(t, dir) {
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
      response.writeHead(404, { 'content-type': TYPES['.html'] });
      createReadStream(notFound).pipe(response);
      return;
    }
    response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    createReadStream(path).pipe(response);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => server.close(done)));
  return `http://127.0.0.1:${server.address().port}`;
}
