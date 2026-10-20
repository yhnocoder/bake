import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkCjkFriendlyStrikethrough from 'remark-cjk-friendly-gfm-strikethrough';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

export const REMARK_PLUGINS = Object.freeze([[remarkGfm, { singleTilde: false }], remarkMath, remarkCjkFriendly, [remarkCjkFriendlyStrikethrough, { singleTilde: false }]]);
