import { bundledLanguages, createCssVariablesTheme, createHighlighter, isPlainLang } from 'shiki';

const THEME = createCssVariablesTheme({ name: 'bake', variablePrefix: '--code-', fontStyle: true });

let highlighterPromise = null;

function highlighter() {
  highlighterPromise ??= createHighlighter({ themes: [THEME], langs: [] });
  return highlighterPromise;
}

export function isKnownLanguage(language) {
  return isPlainLang(language) || Object.hasOwn(bundledLanguages, language);
}

export async function loadLanguages(languages) {
  const instance = await highlighter();
  const missing = [...new Set(languages)].filter((language) => !isPlainLang(language) && !instance.getLoadedLanguages().includes(language));
  if (missing.length > 0) await instance.loadLanguage(...missing);
  return instance;
}

export function highlightCode(instance, code, language) {
  const root = instance.codeToHast(code, { lang: language ?? 'text', theme: THEME.name });
  const pre = root.children[0];
  if (language !== undefined) pre.properties.dataLanguage = language;
  return pre;
}
