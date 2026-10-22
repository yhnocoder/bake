import { join } from 'node:path';
import { readPet } from '../chat/pet-files.js';
import { optionProblem } from '../components/declarations.js';
import { readComponents } from '../components/read.js';
import { CONFIG_FILE, configPosition, loadBakeConfig } from '../config/bake-config.js';
import { PREAMBLE_FILE, readPreamble } from '../config/preamble.js';
import { availableThemes } from '../config/rules.js';
import { BUILT_IN_BLOCK_NAMES } from '../markdown/parse.js';
import { typesetMath } from '../render/math.js';
import { errorAt, fileStart } from '../shared/report.js';
import { builtInThemeFolders } from './theme.js';
import { readThemeDeclarations } from './theme-options.js';
import { PUBLIC_DIR } from './public.js';

// The first of these files in public/ is the icon that every page names.
const ICON_FILES = ['favicon.svg', 'favicon.png', 'favicon.ico'];

export async function readSiteSettings(site, found) {
  const { memo } = site;
  const settings = await memo.get('settings', null, readSettings);
  if (settings.errors.length > 0) return settings;
  const url = site.url ?? settings.config.url ?? site.localUrl;
  if (url === undefined) return { ...settings, errors: [errorAt(CONFIG_FILE, fileStart, `${CONFIG_FILE} has no url, the address of the published site; set url there, or pass it with bake build --url <address>`)] };
  const config = { ...settings.config, url, icon: settings.icon };
  const components = await memo.get('components', { articleDirs: found.map((article) => article.dir) }, (files) => {
    const errors = [];
    return { components: readComponents(files, { builtInBlocks: BUILT_IN_BLOCK_NAMES, articleDirs: files.value((context) => context.articleDirs) }, errors), errors };
  });
  return { ...settings, config, components: components.components, componentErrors: components.errors };
}

async function readSettings(files) {
  const themeNames = availableThemes(files);
  const errors = builtInThemeFolders(files);
  const { options: themeOptions, markdown } = readThemeDeclarations(files, themeNames, errors);
  const config = await loadBakeConfig(files, themeOptions, optionProblem, errors);
  if (config === null || errors.length > 0) return { errors };
  const preamble = await readMathPreamble(files, errors);
  const pet = await readPet(files, config.chat.pet, (file, message) => errors.push(file === null ? errorAt(CONFIG_FILE, configPosition(files.root, ['chat', 'pet']), `chat.pet: ${message}`) : errorAt(file, fileStart, message)));
  const rules = { themes: themeNames, categories: config.categories.map((category) => category.id), theme: config.theme, options: themeOptions, optionProblem };
  const icon = ICON_FILES.find((name) => files.stat(join(files.root, PUBLIC_DIR, name))?.isFile());
  return { errors, config, preamble, pet, rules, markdown, icon };
}

async function readMathPreamble(files, errors) {
  const definitions = readPreamble(files, errors);
  if (definitions.length === 0) return definitions;
  const { definitionErrors } = await typesetMath(definitions, []);
  definitionErrors.forEach((error, index) => {
    if (error !== undefined) errors.push(errorAt(PREAMBLE_FILE, definitions[index].position, `MathJax cannot read this definition: ${error}`));
  });
  return definitions;
}
