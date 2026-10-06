import { createServer } from 'vite';
import { bakeDev, bakeRoot } from './plugin.js';

export async function createDevServer({ root, port }) {
  const server = await createServer({
    root,
    configFile: false,
    appType: 'custom',
    server: { host: 'localhost', port, strictPort: false, fs: { allow: [root, bakeRoot] } },
    plugins: [bakeDev({ root })],
  });
  await server.listen();
  return server;
}
