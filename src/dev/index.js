import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { bakeDev, bakeRoot } from './plugin.js';

export async function createDevServer({ root, port }) {
  const plugin = bakeDev({ root });
  const server = await createServer({
    root,
    configFile: false,
    cacheDir: join(tmpdir(), 'bake-vite', createHash('sha256').update(root).digest('hex').slice(0, 16)),
    appType: 'custom',
    server: { host: 'localhost', port, strictPort: false, fs: { allow: [root, bakeRoot] } },
    plugins: [plugin],
  });
  const messages = plugin.api.siteMessages();
  if (messages.length > 0) {
    await server.close();
    throw Object.assign(new Error('Site has errors'), { messages });
  }
  await server.listen();
  return server;
}
