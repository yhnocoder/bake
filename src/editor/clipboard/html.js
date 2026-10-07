import { fromDom } from 'hast-util-from-dom';
import { toMdast } from 'hast-util-to-mdast';
import { visit } from 'unist-util-visit';

const formulaDisplays = '.katex-html, mjx-assistive-mml';
const removed = 'img, script, style, template';

function formulaElement(document, tex, display) {
  const span = document.createElement('span');
  span.dataset.tex = tex;
  span.textContent = tex;
  if (display) span.className = 'display';
  return span;
}

function replaceFormula(element, tex, display) {
  const document = element.ownerDocument;
  element.replaceWith(tex === null ? document.createTextNode(element.textContent) : formulaElement(document, tex, display));
}

function texAnnotation(element) {
  return element.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? null;
}

function normalizeFormulas(body) {
  for (const element of body.querySelectorAll('[data-tex]')) replaceFormula(element, element.dataset.tex, element.classList.contains('display'));
  for (const element of body.querySelectorAll('.katex')) {
    if (!element.isConnected) continue;
    const display = element.closest('.katex-display');
    replaceFormula(display ?? element, texAnnotation(element), display !== null || element.querySelector('math[display="block"]') !== null);
  }
  for (const element of body.querySelectorAll('mjx-container')) {
    if (!element.isConnected) continue;
    const source = element.querySelector('mjx-math[data-latex]');
    replaceFormula(element, source ? source.getAttribute('data-latex') : null, element.getAttribute('display') === 'true');
  }
  for (const element of body.querySelectorAll('math')) {
    if (!element.isConnected) continue;
    replaceFormula(element, texAnnotation(element) ?? element.getAttribute('alttext'), element.getAttribute('display') === 'block');
  }
}

function markBakeElements(tree) {
  visit(tree, 'element', (node) => {
    if (node.properties.dataTex !== undefined) {
      node.tagName = 'bake-tex';
      return 'skip';
    }
    if (node.properties.dataMd !== undefined) {
      node.tagName = 'bake-md';
      return 'skip';
    }
    return undefined;
  });
}

const handlers = {
  'bake-tex': (_, node) => {
    const value = String(node.properties.dataTex);
    return node.properties.className?.includes('display') ? { type: 'math', value } : { type: 'inlineMath', value };
  },
  'bake-md': (_, node) => ({ type: 'raw', value: String(node.properties.dataMd) }),
  mark: (state, node) => ({ type: 'mark', children: state.all(node) }),
};

const flowParents = new Set(['root', 'blockquote', 'listItem', 'footnoteDefinition']);

function trimmedParagraph(children) {
  const first = children[0];
  const last = children.at(-1);
  if (first?.type === 'text') first.value = first.value.trimStart();
  if (last?.type === 'text') last.value = last.value.trimEnd();
  const content = children.filter((child) => child.type !== 'text' || child.value !== '');
  return content.length > 0 ? [{ type: 'paragraph', children: content }] : [];
}

function splitAtDisplayMath(paragraph) {
  const blocks = [];
  let run = [];
  for (const child of paragraph.children) {
    if (child.type === 'math') {
      blocks.push(...trimmedParagraph(run), child);
      run = [];
    } else run.push(child);
  }
  return [...blocks, ...trimmedParagraph(run)];
}

function normalizeMdast(node) {
  if (!node.children) return;
  node.children = node.children.filter((child) => child.type !== 'link' || child.children.length > 0);
  if (flowParents.has(node.type)) node.children = node.children.flatMap((child) => (child.type === 'paragraph' ? splitAtDisplayMath(child) : [child]));
  for (const child of node.children) {
    if (child.type === 'math' && !flowParents.has(node.type)) child.type = 'inlineMath';
    normalizeMdast(child);
  }
}

export function htmlToMdast(document) {
  for (const element of document.body.querySelectorAll(formulaDisplays)) element.remove();
  normalizeFormulas(document.body);
  for (const element of document.body.querySelectorAll(removed)) element.remove();
  const tree = { type: 'root', children: fromDom(document.body).children };
  markBakeElements(tree);
  const mdast = toMdast(tree, { handlers });
  normalizeMdast(mdast);
  return mdast;
}
