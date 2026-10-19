import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

const root = fileURLToPath(new URL('.', import.meta.url))

export function clientConfig({ components = `${root}components`, outDir = `${root}dist` } = {}) {
  return {
    root,
    base: './',
    configFile: false,
    logLevel: 'warn',
    plugins: [solid()],
    resolve: {
      alias: {
        '@components': components,
        '@jetbrains-mono': `${root}node_modules/@fontsource/jetbrains-mono/files`,
      },
    },
    optimizeDeps: { exclude: ['@mathjax/src', '@mathjax/mathjax-newcm-font'] },
    build: {
      outDir,
      emptyOutDir: true,
      manifest: true,
      assetsInlineLimit: 0,
      chunkSizeWarningLimit: 4000,
      rollupOptions: { input: { main: `${root}page/main.js` } },
    },
  }
}

export default defineConfig(clientConfig())
