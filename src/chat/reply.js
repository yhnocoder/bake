import { toHtml } from 'hast-util-to-html';
import { toHast } from 'mdast-util-to-hast';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkCjkFriendlyStrikethrough from 'remark-cjk-friendly-gfm-strikethrough';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

export const MATH_CLASS = 'bk-chat-math';

const processor = unified().use(remarkParse).use(remarkGfm, { singleTilde: false }).use(remarkMath).use(remarkCjkFriendly).use(remarkCjkFriendlyStrikethrough, { singleTilde: false });
const SCHEME = /^([a-z][a-z\d+.-]*):/i;
const OPEN_SCHEMES = new Set(['http', 'https', 'mailto']);
const CODE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/;

export function replyHtml(markdown, { root }) {
  const tree = toHast(processor.runSync(processor.parse(normalizeMath(markdown))), {
    handlers: {
      math: (state, node) => mathElement('div', node.value, true),
      inlineMath: (state, node) => mathElement('span', node.value, false),
    },
  });
  return toHtml(clean(tree, root));
}

export function normalizeMath(markdown) {
  return markdown
    .split(CODE)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(/\\\[([\s\S]+?)\\\]/g, (match, tex) => `\n$$\n${tex.trim()}\n$$\n`).replace(/\\\(([\s\S]+?)\\\)/g, (match, tex) => `$${tex.trim()}$`),
    )
    .join('');
}

export function linkTarget(href, root) {
  if (href.startsWith('#')) return { href, external: false };
  const scheme = SCHEME.exec(href)?.[1].toLowerCase();
  if (scheme !== undefined) return OPEN_SCHEMES.has(scheme) ? { href, external: true } : null;
  if (href.startsWith('//')) return null;
  return { href: new URL(href.replace(/^\/+/, ''), root).href, external: false };
}

function mathElement(tagName, tex, display) {
  return { type: 'element', tagName, properties: { className: [MATH_CLASS], dataTex: tex, dataDisplay: display ? 'true' : undefined }, children: [{ type: 'text', value: tex }] };
}

function clean(node, root) {
  if (node.children !== undefined) node.children = node.children.filter((child) => child.type !== 'raw').map((child) => clean(child, root));
  if (node.type !== 'element') return node;
  if (node.tagName === 'img') return { type: 'text', value: String(node.properties.alt ?? '') };
  if (node.tagName !== 'a') return node;
  const target = linkTarget(String(node.properties.href ?? ''), root);
  if (target === null) return { type: 'element', tagName: 'span', properties: {}, children: node.children };
  node.properties.href = target.href;
  if (target.external) Object.assign(node.properties, { target: '_blank', rel: ['noopener', 'noreferrer'] });
  return node;
}
