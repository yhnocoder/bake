import { Fragment } from '@milkdown/prose/model';
import { docToMarkdown } from '../markdown.js';

function unwrap({ content, openStart, openEnd }) {
  while (openStart > 0 && openEnd > 0 && content.childCount === 1 && !content.firstChild.isTextblock) {
    content = content.firstChild.content;
    openStart--;
    openEnd--;
  }
  return content;
}

function withHeaderRow(content, schema) {
  const { table_row: row, table_header_row: headerRow, table_header: header } = schema.nodes;
  if (content.firstChild?.type !== row) return content;
  const cells = [];
  content.firstChild.forEach((cell) => cells.push(header.create(cell.attrs, cell.content)));
  return content.replaceChild(0, headerRow.create(null, cells));
}

export function sliceToMarkdown(ctx, slice, schema) {
  let content = withHeaderRow(unwrap(slice), schema);
  if (content.firstChild?.isInline) content = Fragment.from(schema.nodes.paragraph.create(null, content));
  const wrapping = content.firstChild ? schema.topNodeType.contentMatch.findWrapping(content.firstChild.type) : [];
  for (const type of [...(wrapping ?? [])].reverse()) content = Fragment.from(type.create(null, content));
  const doc = schema.topNodeType.createAndFill(null, content);
  return docToMarkdown(ctx, doc).replace(/\n$/, '');
}
