import { directiveToMarkdown } from 'mdast-util-directive';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough';
import remarkDirective from 'remark-directive';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import builtinBlocks from '../blocks/index.js';
import remarkAttributes from './attributes.js';
import remarkBlockId from './block-id.js';
import remarkHighlight from './highlight.js';
import { createRegistry } from './registry.js';

function remarkUnquotedDirectiveAttributes() {
  this.data().toMarkdownExtensions.push(directiveToMarkdown({ preferUnquoted: true }));
}

export function createProcessor({ blocks = [], components } = {}) {
  return unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkGfm, { tablePipeAlign: false })
    .use(remarkCjkFriendly)
    .use(remarkCjkFriendlyGfmStrikethrough)
    .use(remarkMath)
    .use(remarkDirective)
    .use(remarkUnquotedDirectiveAttributes)
    .use(remarkHighlight)
    .use(remarkAttributes)
    .use(remarkBlockId)
    .use(remarkStringify, {
      bullet: '-',
      emphasis: '*',
      strong: '*',
      fence: '`',
      fences: true,
      rule: '-',
      listItemIndent: 'one',
      incrementListMarker: true,
    })
    .data('registry', createRegistry(builtinBlocks, blocks))
    .data('components', components);
}
