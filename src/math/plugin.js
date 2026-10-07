import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const configModule = 'virtual:bake/math-config';
const fontsModule = 'virtual:bake/mathjax-fonts';
const fontPrefix = '@mathjax/mathjax-newcm-font/js/svg/dynamic';

const fontDirectory = dirname(fileURLToPath(import.meta.resolve('@mathjax/mathjax-newcm-font/js/svg.js')));

function fontTable() {
  const directory = join(fontDirectory, 'svg', 'dynamic');
  const entries = readdirSync(directory)
    .filter((name) => name.endsWith('.js'))
    .map((name) => `  ${JSON.stringify(`${fontPrefix}/${name}`)}: () => import(${JSON.stringify(join(directory, name))}),`);
  return `export default {\n${entries.join('\n')}\n};\n`;
}

export const mathConfigId = `\0${configModule}`;

export function bakeMath({ getConfig }) {
  return {
    name: 'bake-math',
    // why(#13): the dynamic font files import the font class by relative path; prebundling would load a second copy that never receives their glyphs
    config: () => ({ optimizeDeps: { exclude: ['@mathjax/src', '@mathjax/mathjax-newcm-font'] } }),
    resolveId(id) {
      if (id === configModule || id === fontsModule) return `\0${id}`;
      return undefined;
    },
    load(id) {
      if (id === mathConfigId) return `export default ${JSON.stringify(getConfig().math.macros)};\n`;
      if (id === `\0${fontsModule}`) return fontTable();
      // why(#13): the font package ships sourcemaps without their sources, so Vite would print a warning for every font file
      const file = id.split('?')[0];
      if (file.startsWith(fontDirectory) && file.endsWith('.js')) return { code: readFileSync(file, 'utf8'), map: { mappings: '' } };
      return undefined;
    },
  };
}
