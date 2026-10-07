import { directiveToMarkdown } from 'mdast-util-directive';
import { gfmToMarkdown } from 'mdast-util-gfm';
import { mathToMarkdown } from 'mdast-util-math';
import { cjkFriendlyToMarkdown } from 'mdast-util-to-markdown-cjk-friendly';
import { cjkFriendlyGfmStrikethroughToMarkdown } from 'mdast-util-to-markdown-cjk-friendly-gfm-strikethrough';
import { attributesToMarkdown } from './attributes.js';
import { blockIdToMarkdown } from './block-id.js';
import { highlightToMarkdown } from './highlight.js';

export const markdownOptions = {
  bullet: '-',
  emphasis: '*',
  strong: '*',
  fence: '`',
  fences: true,
  rule: '-',
  listItemIndent: 'one',
  incrementListMarker: true,
};

function rawToMarkdown() {
  return { handlers: { raw: (node) => node.value } };
}

export const toMarkdownExtensions = [
  gfmToMarkdown({ tablePipeAlign: false }),
  cjkFriendlyToMarkdown(),
  cjkFriendlyGfmStrikethroughToMarkdown(),
  mathToMarkdown(),
  directiveToMarkdown({ preferUnquoted: true }),
  highlightToMarkdown(),
  attributesToMarkdown(),
  blockIdToMarkdown(),
  rawToMarkdown(),
];
