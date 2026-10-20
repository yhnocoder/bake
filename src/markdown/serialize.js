import { gfmToMarkdown } from 'mdast-util-gfm';
import { mathToMarkdown } from 'mdast-util-math';
import { defaultHandlers, toMarkdown } from 'mdast-util-to-markdown';
import { cjkFriendlyToMarkdown } from 'mdast-util-to-markdown-cjk-friendly';
import { cjkFriendlyGfmStrikethroughToMarkdown } from 'mdast-util-to-markdown-cjk-friendly-gfm-strikethrough';
import { writeAttributes } from './attributes.js';
import { bakeBlocksToMarkdown } from './block-syntax.js';
import { citationsToMarkdown } from './bracket-syntax.js';
import { equationReferencesToMarkdown } from './eqref-syntax.js';
import { highlightToMarkdown } from './highlight-syntax.js';

const CONSTRUCTS_WITHOUT_EMPHASIS = ['autolink', 'destinationLiteral', 'destinationRaw', 'reference', 'titleQuote', 'titleApostrophe'];
// why: safe() drops an escape whose only condition is a neighbour it escapes; a pattern with only before and one with only after, both matching the same asterisks, make the escape unconditional
const ASTERISK_NEXT_TO_TEXT = [
  { character: '*', before: '(?<=\\S)|(?=\\*\\S)', inConstruct: 'phrasing', notInConstruct: CONSTRUCTS_WITHOUT_EMPHASIS },
  { character: '*', after: '(?<=\\S\\*)|(?=\\S)', inConstruct: 'phrasing', notInConstruct: CONSTRUCTS_WITHOUT_EMPHASIS },
];

const OPTIONS = {
  bullet: '-',
  rule: '-',
  emphasis: '*',
  strong: '*',
  fence: '`',
  listItemIndent: 'one',
  extensions: [
    gfmToMarkdown({ tablePipeAlign: false }),
    mathToMarkdown(),
    cjkFriendlyToMarkdown(),
    cjkFriendlyGfmStrikethroughToMarkdown(),
    highlightToMarkdown,
    citationsToMarkdown,
    equationReferencesToMarkdown,
    bakeBlocksToMarkdown,
  ],
  handlers: { root: writeRoot, heading: writeHeading, image: writeImage, verbatim: (node) => node.value },
};

export function serializeMarkdown(tree) {
  return toMarkdown(tree, OPTIONS);
}

function writeRoot(node, parent, state, info) {
  state.unsafe = [...state.unsafe.filter((pattern) => !isEveryAsteriskInPhrasing(pattern)), ...ASTERISK_NEXT_TO_TEXT];
  return defaultHandlers.root(node, parent, state, info);
}

function isEveryAsteriskInPhrasing(pattern) {
  return pattern.character === '*' && pattern.inConstruct === 'phrasing' && !pattern.atBreak && pattern.before === undefined && pattern.after === undefined;
}

function writeHeading(node, parent, state, info) {
  const heading = defaultHandlers.heading(node, parent, state, info);
  const attributes = writeAttributes(node.attributes ?? {});
  return attributes === '' ? heading : `${heading} ${attributes}`;
}

function writeImage(node, parent, state, info) {
  return `${defaultHandlers.image(node, parent, state, info)}${writeAttributes(node.attributes ?? {})}`;
}
writeImage.peek = defaultHandlers.image.peek;
