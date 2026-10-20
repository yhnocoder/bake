import { toHtml } from 'hast-util-to-html';
import { defaultHandlers, toHast } from 'mdast-util-to-hast';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { REMARK_PLUGINS } from '../markdown/remark-plugins.js';
import { parseWithPipesInMath } from '../markdown/table-math.js';
import { texDelimiters } from './tex-delimiters.js';

export const MATH_CLASS = 'bk-chat-math';

const processor = unified().use(remarkParse).use(REMARK_PLUGINS).use(texDelimiters);
const SCHEME = /^([a-z][a-z\d+.-]*):/i;
const OPEN_SCHEMES = new Set(['http', 'https', 'mailto']);

export function markdownTree(markdown) {
  return processor.runSync(parseWithPipesInMath(processor, markdown).tree);
}

export function replyHtml(markdown, { root, base }) {
  return markdownHtml(markdownTree(markdown), { root, base });
}

export function markdownHtml(tree, { root, base, handlers = {} }) {
  const hast = toHast(tree, {
    handlers: {
      math: (state, node) => mathElement('div', node.value, true),
      inlineMath: (state, node) => mathElement('span', node.value, node.data?.display === true),
      paragraph: paragraphElement,
      ...handlers,
    },
  });
  return toHtml(clean(hast, root, base));
}

export function paragraphElement(state, node) {
  return node.children.length === 1 && node.children[0].data?.display === true ? mathElement('div', node.children[0].value, true) : defaultHandlers.paragraph(state, node);
}

export function linkTarget(href, root, base) {
  if (href.startsWith('#')) {
    if (base === undefined) return { href, external: false };
    const resolved = new URL(`${base.replace(/^\/+/, '')}${href}`, root).href;
    return resolved.startsWith(root) ? { href: resolved, external: false } : null;
  }
  const scheme = SCHEME.exec(href)?.[1].toLowerCase();
  if (scheme !== undefined) return OPEN_SCHEMES.has(scheme) ? { href, external: true } : null;
  if (href.startsWith('//')) return null;
  return { href: new URL(href.replace(/^\/+/, ''), root).href, external: false };
}

function mathElement(tagName, tex, display) {
  return { type: 'element', tagName, properties: { className: [MATH_CLASS], dataTex: tex, dataDisplay: display ? 'true' : undefined }, children: [{ type: 'text', value: tex }] };
}

function clean(node, root, base) {
  if (node.children !== undefined) node.children = node.children.filter((child) => child.type !== 'raw').map((child) => clean(child, root, base));
  if (node.type !== 'element') return node;
  if (node.tagName === 'img') return { type: 'text', value: String(node.properties.alt ?? '') };
  if (node.tagName !== 'a') return node;
  const target = linkTarget(String(node.properties.href ?? ''), root, base);
  if (target === null) return { type: 'element', tagName: 'span', properties: {}, children: node.children };
  node.properties.href = target.href;
  if (target.external) Object.assign(node.properties, { target: '_blank', rel: ['noopener', 'noreferrer'] });
  return node;
}
