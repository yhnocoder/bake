import { bundledLanguages, createCssVariablesTheme, createHighlighter } from 'shiki';

const THEME = createCssVariablesTheme({ name: 'bake', variablePrefix: '--code-', fontStyle: true });
const PLAIN_LANGUAGES = ['text', 'txt', 'plain', 'plaintext'];

let highlighterPromise = null;

function highlighter() {
  highlighterPromise ??= createHighlighter({ themes: [THEME], langs: [] });
  return highlighterPromise;
}

export function isKnownLanguage(language) {
  return PLAIN_LANGUAGES.includes(language) || Object.hasOwn(bundledLanguages, language);
}

export async function loadLanguages(languages) {
  const instance = await highlighter();
  const missing = [...new Set(languages)].filter((language) => !PLAIN_LANGUAGES.includes(language) && !instance.getLoadedLanguages().includes(language));
  if (missing.length > 0) await instance.loadLanguage(...missing);
  return instance;
}

export function highlightCode(instance, code, language) {
  const root = instance.codeToHast(code, { lang: language ?? 'text', theme: THEME.name });
  const pre = root.children[0];
  if (language !== undefined) pre.properties.dataLanguage = language;
  return pre;
}
