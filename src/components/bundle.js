import { join } from 'node:path';
import { build } from 'vite';
import solid from 'vite-plugin-solid';
import { compileProblem, outputOf, viteConfig } from '../build/vite.js';
import { errorAt, fileStart } from '../report.js';
import { COMPONENTS_DIR } from './read.js';
import { RUNTIME_FILE, browserModules, isMathJaxModule } from './modules.js';

const CHAT_ENTRY = join(import.meta.dirname, '../chat/entry.js');

export async function bundlePageModules(root, components, preamble, errors) {
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
          input: { ...(components.length === 0 ? {} : { components: RUNTIME_FILE }), chat: CHAT_ENTRY },
          output: {
            format: 'es',
            entryFileNames: 'assets/[name]-[hash].js',
            chunkFileNames: 'assets/[name]-[hash].js',
            assetFileNames: 'assets/[name]-[hash][extname]',
            codeSplitting: { groups: [{ name: 'mathjax', test: isMathJaxModule }] },
          },
        },
      },
    });
    const outputs = outputOf(result);
    const entry = (name) => outputs.find((output) => output.type === 'chunk' && output.isEntry && output.name === name)?.fileName;
    return {
      runtime: entry('components'),
      chat: entry('chat'),
      files: outputs.map((output) => ({ path: output.fileName, source: output.type === 'chunk' ? output.code : output.source })),
    };
  } catch (error) {
    const { message, file, position } = compileProblem(root, error);
    errors.push(file === null ? errorAt(COMPONENTS_DIR, fileStart, `the components cannot be built: ${message}`) : errorAt(file, position, message));
    return null;
  }
}
