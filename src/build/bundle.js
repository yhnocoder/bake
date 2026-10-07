import { readFile, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { build } from 'vite';

const clientScripts = ['page', 'copy'].map((name) => ({ name: `client/${name}`, path: fileURLToPath(new URL(`../client/${name}.js`, import.meta.url)) }));
const componentHelpers = fileURLToPath(new URL('../client/component.js', import.meta.url));
const styles = ['base', 'blocks', 'layouts'].map((name) => fileURLToPath(new URL(`../styles/${name}.css`, import.meta.url)));
const virtualPrefix = '\0bake:';

function errorLines(root, error) {
  return (error.errors ?? [error]).map((item) => {
    const text = stripVTControlCharacters(item.message.split('\n')[0]);
    if (!item.loc?.file || item.loc.line === undefined) return text;
    return `${relative(root, item.loc.file)}:${item.loc.line}:${item.loc.column + 1} ${text}`;
  });
}

export async function bundle(site, { outDir, components, themes }) {
  const modules = { 'bake.css': styles.map((path) => `@import ${JSON.stringify(path)};\n`).join('') };
  const input = { bake: 'bake.css', ...Object.fromEntries(clientScripts.map(({ name, path }) => [name, path])) };
  for (const name of components) {
    const path = join(site.root, site.components[name].path);
    modules[`component-${name}.js`] = [
      `import { observedAttributes } from ${JSON.stringify(componentHelpers)};`,
      `import Component from ${JSON.stringify(path)};`,
      `customElements.define(${JSON.stringify(name)}, class extends Component {`,
      '  static observedAttributes = observedAttributes(Component.properties);',
      '});',
      '',
    ].join('\n');
    input[`components/${name}`] = `component-${name}.js`;
  }
  for (const theme of themes) input[`themes/${theme}`] = join(site.root, site.themes[theme]);
  const plugin = {
    name: 'bake-entries',
    resolveId: (id) => (Object.hasOwn(modules, id) ? virtualPrefix + id : null),
    load: (id) => (id.startsWith(virtualPrefix) ? modules[id.slice(virtualPrefix.length)] : null),
  };
  try {
    await build({
      configFile: false,
      logLevel: 'silent',
      root: site.root,
      base: site.config.base,
      publicDir: false,
      plugins: [plugin],
      build: {
        outDir,
        emptyOutDir: true,
        manifest: true,
        rolldownOptions: {
          input,
          output: {
            entryFileNames: 'assets/[name].[hash].js',
            chunkFileNames: 'assets/chunks/[name].[hash].js',
            assetFileNames: 'assets/[name].[hash][extname]',
          },
        },
      },
    });
  } catch (error) {
    return { errors: errorLines(site.root, error) };
  }
  const manifestPath = join(outDir, '.vite/manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await rm(join(outDir, '.vite'), { recursive: true });
  const files = Object.fromEntries(
    Object.values(manifest)
      .filter((chunk) => chunk.isEntry)
      .map((chunk) => [chunk.name, `${site.config.base}${chunk.file}`]),
  );
  return { files, client: clientScripts.map(({ name }) => files[name]) };
}
