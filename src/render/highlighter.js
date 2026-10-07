import { bundledLanguages, createCssVariablesTheme, createHighlighter } from 'shiki';

const plainLanguages = new Set(['text', 'txt', 'plain']);

export const codeTheme = createCssVariablesTheme({
  name: 'bake',
  variablePrefix: '--code-',
  variableDefaults: {
    foreground: 'var(--color-text)',
    'token-keyword': 'var(--color-accent)',
    'token-comment': 'var(--color-muted)',
    'token-string': 'var(--color-mark-text)',
    'token-string-expression': 'var(--color-mark-text)',
    'token-constant': 'var(--color-text)',
    'token-parameter': 'var(--color-text)',
    'token-function': 'var(--color-text)',
    'token-punctuation': 'var(--color-text)',
    'token-link': 'var(--color-text)',
    'token-inserted': 'var(--color-text)',
    'token-deleted': 'var(--color-text)',
    'token-changed': 'var(--color-text)',
  },
  fontStyle: true,
});

let highlighterPromise;
const languageLoads = new Map();

export function languageKind(lang) {
  if (!lang || plainLanguages.has(lang)) return 'plain';
  return Object.hasOwn(bundledLanguages, lang) ? 'known' : 'unknown';
}

export function highlighter() {
  highlighterPromise ??= createHighlighter({ themes: [codeTheme], langs: [] }).catch((error) => {
    highlighterPromise = undefined;
    throw error;
  });
  return highlighterPromise;
}

export function loadLanguage(lang) {
  if (!languageLoads.has(lang)) {
    const load = highlighter().then((shiki) => shiki.loadLanguage(lang));
    languageLoads.set(lang, load);
    load.catch(() => languageLoads.delete(lang));
  }
  return languageLoads.get(lang);
}

export function codeToLines(shiki, code, lang, transformers = []) {
  const [pre] = shiki.codeToHast(code, { lang, theme: 'bake', transformers }).children;
  return pre.children[0].children;
}
