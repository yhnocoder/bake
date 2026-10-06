import { remarkStringifyOptionsCtx } from '@milkdown/core';
import { commonmark, remarkHtmlTransformer, remarkPreserveEmptyLinePlugin, syncHeadingIdPlugin } from '@milkdown/preset-commonmark';
import { gfm, remarkGFMPlugin } from '@milkdown/preset-gfm';
import { $remark } from '@milkdown/utils';
import { remarkPlugins } from '../format/processor.js';
import { markdownOptions } from '../format/to-markdown.js';

const replacedPlugins = new Set([remarkPreserveEmptyLinePlugin, remarkHtmlTransformer, syncHeadingIdPlugin, remarkGFMPlugin].flat());

export const presets = [...commonmark, ...gfm].filter((plugin) => !replacedPlugins.has(plugin));

export const bakeRemark = remarkPlugins.flatMap(([plugin, options], index) => $remark(`bake-remark-${index}`, () => plugin, options));

export function configureStringify(ctx) {
  ctx.set(remarkStringifyOptionsCtx, markdownOptions);
}
