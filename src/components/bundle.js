import { build } from 'vite';
import solid from 'vite-plugin-solid';
import { compileProblem, outputOf, viteConfig } from '../build/vite.js';
import { errorAt, fileStart } from '../report.js';
import { COMPONENTS_DIR } from './read.js';
import { RUNTIME_FILE, browserModules } from './modules.js';

export async function bundleComponents(root, components, preamble, errors) {
  try {
    const result = await build({
      ...viteConfig([browserModules({ preamble, components }), solid()]),
      base: './',
      build: {
        write: false,
        cssCodeSplit: true,
        assetsInlineLimit: 0,
        modulePreload: { polyfill: false },
        rolldownOptions: {
          input: { components: RUNTIME_FILE },
          output: {
            format: 'es',
            entryFileNames: 'assets/[name]-[hash].js',
            chunkFileNames: 'assets/[name]-[hash].js',
            assetFileNames: 'assets/[name]-[hash][extname]',
          },
        },
      },
    });
    const outputs = outputOf(result);
    const runtime = outputs.find((output) => output.type === 'chunk' && output.isEntry);
    return {
      runtime: runtime.fileName,
      files: outputs.map((output) => ({ path: output.fileName, source: output.type === 'chunk' ? output.code : output.source })),
    };
  } catch (error) {
    const { message, file, position } = compileProblem(root, error);
    errors.push(file === null ? errorAt(COMPONENTS_DIR, fileStart, `the components cannot be built: ${message}`) : errorAt(file, position, message));
    return null;
  }
}
