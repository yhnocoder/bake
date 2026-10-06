import { defaultHandlers } from 'mdast-util-to-markdown';
import { visit } from 'unist-util-visit';

const blockId = / \^([A-Za-z0-9-]+)$/;

function transformBlockId(tree, file) {
  const source = String(file.value);
  visit(tree, 'paragraph', (paragraph) => {
    const last = paragraph.children.at(-1);
    if (last?.type !== 'text' || !last.position) return;
    const match = blockId.exec(last.value);
    if (!match || !source.slice(last.position.start.offset, last.position.end.offset).endsWith(match[0])) return;
    last.value = last.value.slice(0, -match[0].length);
    if (last.value === '') paragraph.children.pop();
    paragraph.data = { ...paragraph.data, blockId: match[1] };
  });
}

function handleParagraph(node, parent, state, info) {
  const value = defaultHandlers.paragraph(node, parent, state, info);
  return node.data?.blockId ? `${value} ^${node.data.blockId}` : value;
}

export default function remarkBlockId() {
  const data = this.data();
  (data.toMarkdownExtensions ??= []).push({ handlers: { paragraph: handleParagraph } });
  return transformBlockId;
}
