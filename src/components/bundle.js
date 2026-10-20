import solid from 'vite-plugin-solid';
import { publicModules } from '../bundle/modules.js';
import { browserBuild, compileProblem } from '../bundle/vite.js';
import { errorAt, fileStart } from '../report.js';
import { COMPONENTS_DIR } from './read.js';
import { RUNTIME_FILE, browserModules } from './modules.js';

export async function bundleComponents(root, components, preamble, errors) {
  try {
    const { entry, files } = await browserBuild({
      input: { components: RUNTIME_FILE },
      plugins: [...browserModules({ preamble, components }), solid()],
      alias: publicModules('components'),
    });
    return { runtime: entry, files };
  } catch (error) {
    const { message, file, position } = compileProblem(root, error);
    errors.push(file === null ? errorAt(COMPONENTS_DIR, fileStart, `the components cannot be built: ${message}`) : errorAt(file, position, message));
    return null;
  }
}
