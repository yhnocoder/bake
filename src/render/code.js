import { bundledLanguages, createCssVariablesTheme, createHighlighter } from 'shiki';
import { visit } from 'unist-util-visit';

const plainLanguages = new Set(['text', 'txt', 'plain']);

const theme = createCssVariablesTheme({
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

export function highlighter() {
  highlighterPromise ??= createHighlighter({ themes: [theme], langs: [] }).catch((error) => {
    highlighterPromise = undefined;
    throw error;
  });
  return highlighterPromise;
}

function loadLanguage(lang) {
  if (!languageLoads.has(lang)) {
    const load = highlighter().then((shiki) => shiki.loadLanguage(lang));
    languageLoads.set(lang, load);
    load.catch(() => languageLoads.delete(lang));
  }
  return languageLoads.get(lang);
}

export async function highlightCode(tree, report) {
  const blocks = [];
  visit(tree, 'code', (node) => {
    if (!node.lang || plainLanguages.has(node.lang)) return;
    if (!Object.hasOwn(bundledLanguages, node.lang)) {
      report(node, `Unknown code language ${node.lang}`);
      return;
    }
    blocks.push(node);
  });
  if (blocks.length === 0) return;
  const failures = new Map();
  const languages = [...new Set(blocks.map((node) => node.lang))];
  await Promise.all(languages.map((lang) => loadLanguage(lang).catch((error) => failures.set(lang, error))));
  const shiki = await highlighter();
  for (const node of blocks) {
    const failure = failures.get(node.lang);
    if (failure) {
      report(node, `Cannot load code language ${node.lang}: ${failure.message}`);
      continue;
    }
    const [pre] = shiki.codeToHast(node.value, { lang: node.lang, theme: 'bake' }).children;
    node.data = { ...node.data, hChildren: pre.children[0].children };
  }
}
