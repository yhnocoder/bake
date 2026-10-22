import solid from 'vite-plugin-solid';
import { publicModules } from '../bundle/modules.js';
import { browserBuild, compileProblem } from '../bundle/vite.js';
import { errorAt, fileStart } from '../shared/report.js';
import { COMPONENTS_DIR } from './read.js';
import { RUNTIME_FILE, browserModules } from './modules.js';

export async function bundleComponents(files, components, preamble, errors, { prefetch }) {
  const started = Date.now();
  try {
    const bundle = await browserBuild({
      input: { components: RUNTIME_FILE },
      plugins: [...browserModules({ preamble, components, prefetch }), solid()],
      alias: publicModules('components'),
    });
    files.modules(bundle.modules, started);
    return { runtime: bundle.entry, files: bundle.files };
  } catch (error) {
    files.everything();
    const { message, file, position } = compileProblem(files.root, error);
    errors.push(file === null ? errorAt(COMPONENTS_DIR, fileStart, `the components cannot be built: ${message}`) : errorAt(file, position, message));
    return null;
  }
}
