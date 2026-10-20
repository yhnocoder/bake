import { serveStatic } from '../../scripts/static-server.js';

export async function serve(t, dir) {
  const server = await serveStatic(dir);
  t.after(server.close);
  return server.origin;
}
