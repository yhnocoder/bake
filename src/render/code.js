import { visit } from 'unist-util-visit';
import { codeToLines, highlighter, languageKind, loadLanguage } from './highlighter.js';

export async function highlightCode(tree, report) {
  const blocks = [];
  visit(tree, 'code', (node) => {
    const kind = languageKind(node.lang);
    if (kind === 'unknown') report(node, `Unknown code language ${node.lang}`);
    if (kind === 'known') blocks.push(node);
  });
  if (blocks.length === 0) return;
  const failures = new Map();
  const languages = [...new Set(blocks.map((node) => node.lang))];
  await Promise.all(languages.map((lang) => loadLanguage(lang).catch((error) => failures.set(lang, error))));
  const highlighted = blocks.filter((node) => {
    const failure = failures.get(node.lang);
    if (failure) report(node, `Cannot load code language ${node.lang}: ${failure.message}`);
    return !failure;
  });
  if (highlighted.length === 0) return;
  const shiki = await highlighter();
  for (const node of highlighted) {
    node.data = { ...node.data, hChildren: codeToLines(shiki, node.value, node.lang) };
  }
}
