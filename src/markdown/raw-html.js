import { fromHtml } from 'hast-util-from-html';
import { urlAttributes } from 'html-url-attributes';

const SRCSET_CANDIDATE = /[\s,]*([^\s,](?:\S*[^\s,])?)[^,]*/g;
const TRAILING_SPACE = /\s*$/;

export function readRawHtml(value) {
  const ids = [];
  const addresses = [];
  const idRanges = [];
  const visit = (node) => {
    if (node.type === 'element') {
      const { properties } = node;
      if (typeof properties.id === 'string') {
        ids.push(properties.id);
        const { start, end } = node.data.position.properties.id;
        idRanges.push({ start: start.offset - TRAILING_SPACE.exec(value.slice(0, start.offset))[0].length, end: end.offset });
      }
      for (const [name, tags] of Object.entries(urlAttributes)) {
        if (typeof properties[name] === 'string' && (tags === null || tags.includes(node.tagName))) addresses.push(properties[name]);
      }
      if (typeof properties.srcSet === 'string') for (const [, url] of properties.srcSet.matchAll(SRCSET_CANDIDATE)) addresses.push(url);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(fromHtml(value, { fragment: true, verbose: true }));
  const withoutIds = idRanges.reduceRight((text, { start, end }) => text.slice(0, start) + text.slice(end), value);
  return { ids, addresses, withoutIds };
}
