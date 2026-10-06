import { join } from 'node:path';
import { createServer } from 'vite';
import { bakeMath } from '../math/plugin.js';
import { bakeDev, bakeRoot } from './plugin.js';

export async function createDevServer({ root, port }) {
  const dev = bakeDev({ root });
  const server = await createServer({
    root,
    configFile: false,
    appType: 'custom',
    server: { host: 'localhost', port, strictPort: false, fs: { allow: [root, bakeRoot] } },
    optimizeDeps: { entries: [join(bakeRoot, 'src/editor/session.js')] },
    plugins: [dev, bakeMath({ getConfig: () => dev.api.site().config })],
  });
  await server.listen();
  return server;
}
