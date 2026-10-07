import { join } from 'node:path';
import { createServer, createServerModuleRunner } from 'vite';

export async function createModuleLoader(root, { server } = {}) {
  const ownServer = server
    ? null
    : await createServer({
        root,
        configFile: false,
        appType: 'custom',
        logLevel: 'silent',
        server: { middlewareMode: true, hmr: false, ws: false },
        optimizeDeps: { noDiscovery: true },
      });
  const environment = (server ?? ownServer).environments.ssr;
  const runner = createServerModuleRunner(environment, { hmr: false });
  return {
    import: (path) => runner.import(join(root, path)),
    invalidate(file) {
      environment.moduleGraph.onFileChange(file);
      runner.clearCache();
    },
    async close() {
      await runner.close();
      await ownServer?.close();
    },
  };
}
