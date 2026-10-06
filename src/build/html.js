import { fromHtml } from 'hast-util-from-html';
import { toHtml } from 'hast-util-to-html';
import { visit } from 'unist-util-visit';

export function rewriteHtml(html, { base, images }) {
  const tree = fromHtml(html, { fragment: true });
  visit(tree, 'element', (node) => {
    const { href, src } = node.properties;
    if (node.tagName === 'a' && typeof href === 'string' && href.startsWith('/') && !href.startsWith('//')) {
      node.properties.href = base + href.slice(1);
    }
    if (node.tagName === 'img' && images.has(src)) {
      const { url, width, height } = images.get(src);
      Object.assign(node.properties, { src: url, width, height, loading: 'lazy' });
    }
  });
  return toHtml(tree, { closeEmptyElements: true });
}
