import { commandsCtx } from '@milkdown/core';
import { markRule } from '@milkdown/prose';
import { toggleMark } from '@milkdown/prose/commands';
import { codeBlockSchema, headingSchema, imageSchema, paragraphSchema } from '@milkdown/preset-commonmark';
import { footnoteDefinitionSchema, footnoteReferenceSchema } from '@milkdown/preset-gfm';
import { $command, $inputRule, $markSchema, $useKeymap } from '@milkdown/utils';
import { imageAppearance } from '../render/image.js';
import { footnoteKey } from './footnote-labels.js';

const heading = headingSchema.extendSchema((previous) => (ctx) => {
  const base = previous(ctx);
  return {
    ...base,
    attrs: { ...base.attrs, attributes: { default: null } },
    toDOM: (node) => [`h${node.attrs.level}`, 0],
    parseMarkdown: {
      match: base.parseMarkdown.match,
      runner: (state, node, type) => {
        state.openNode(type, { level: node.depth, attributes: node.data?.attributes ?? null });
        state.next(node.children);
        state.closeNode();
      },
    },
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, node) => {
        const data = node.attrs.attributes ? { data: { attributes: node.attrs.attributes } } : {};
        state.openNode('heading', undefined, { depth: node.attrs.level, ...data });
        state.next(node.content);
        state.closeNode();
      },
    },
  };
});

const paragraph = paragraphSchema.extendSchema((previous) => (ctx) => {
  const base = previous(ctx);
  return {
    ...base,
    attrs: { blockId: { default: null } },
    toDOM: (node) => ['p', node.attrs.blockId ? { id: node.attrs.blockId } : {}, 0],
    parseMarkdown: {
      match: (node) => node.type === 'paragraph' && node.data?.directiveLabel !== true,
      runner: (state, node, type) => {
        state.openNode(type, { blockId: node.data?.blockId ?? null });
        state.next(node.children);
        state.closeNode();
      },
    },
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, node) => {
        state.openNode('paragraph', undefined, node.attrs.blockId ? { data: { blockId: node.attrs.blockId } } : {});
        state.next(node.content);
        state.closeNode();
      },
    },
  };
});

function imageDom(node) {
  const { className, style } = imageAppearance(node.attrs.attributes ?? undefined);
  const image = ['img', style ? { src: node.attrs.src, alt: node.attrs.alt, style } : { src: node.attrs.src, alt: node.attrs.alt }];
  const figure = { class: className.join(' '), contenteditable: 'false' };
  return node.attrs.alt ? ['figure', figure, image, ['figcaption', node.attrs.alt]] : ['figure', figure, image];
}

const image = imageSchema.extendSchema((previous) => (ctx) => {
  const base = previous(ctx);
  return {
    ...base,
    attrs: { ...base.attrs, title: { default: null }, attributes: { default: null } },
    toDOM: imageDom,
    parseMarkdown: {
      match: base.parseMarkdown.match,
      runner: (state, node, type) => {
        state.addNode(type, { src: node.url, alt: node.alt ?? '', title: node.title ?? null, attributes: node.data?.attributes ?? null });
      },
    },
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, node) => {
        const data = node.attrs.attributes ? { data: { attributes: node.attrs.attributes } } : {};
        state.addNode('image', undefined, undefined, { url: node.attrs.src, alt: node.attrs.alt, title: node.attrs.title, ...data });
      },
    },
  };
});

const codeBlock = codeBlockSchema.extendSchema((previous) => (ctx) => {
  const base = previous(ctx);
  return {
    ...base,
    attrs: { ...base.attrs, meta: { default: null } },
    parseMarkdown: {
      match: base.parseMarkdown.match,
      runner: (state, node, type) => {
        state.openNode(type, { language: node.lang ?? '', meta: node.meta ?? null });
        if (node.value) state.addText(node.value);
        state.closeNode();
      },
    },
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, node) => {
        state.addNode('code', undefined, node.textContent, { lang: node.attrs.language || null, meta: node.attrs.meta });
      },
    },
  };
});

const footnoteReference = footnoteReferenceSchema.extendSchema((previous) => (ctx) => {
  const base = previous(ctx);
  return {
    ...base,
    toDOM: (node) => ['sup', { class: 'sidenote-ref' }, ['a', node.attrs.label]],
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, node) => {
        state.addNode('footnoteReference', undefined, undefined, { label: node.attrs.label, identifier: footnoteKey(node.attrs.label) });
      },
    },
  };
});

const footnoteDefinition = footnoteDefinitionSchema.extendSchema((previous) => (ctx) => {
  const base = previous(ctx);
  return {
    ...base,
    toDOM: (node) => ['div', { class: 'footnote-definition' }, ['span', { class: 'footnote-label', contenteditable: 'false' }, `[^${node.attrs.label}]`], ['div', 0]],
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, node) => {
        state.openNode('footnoteDefinition', undefined, { label: node.attrs.label, identifier: footnoteKey(node.attrs.label) });
        state.next(node.content);
        state.closeNode();
      },
    },
  };
});

const highlightSchema = $markSchema('mark', () => ({
  parseDOM: [{ tag: 'mark' }],
  toDOM: () => ['mark', 0],
  parseMarkdown: {
    match: (node) => node.type === 'mark',
    runner: (state, node, type) => {
      state.openMark(type);
      state.next(node.children);
      state.closeMark(type);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'mark',
    runner: (state, mark) => {
      state.withMark(mark, 'mark');
    },
  },
}));

const toggleHighlight = $command('ToggleHighlight', (ctx) => () => toggleMark(highlightSchema.type(ctx)));

const highlightInputRule = $inputRule((ctx) => markRule(/(?<![=\\])==([^=]+)==$/, highlightSchema.type(ctx)));

const highlightKeymap = $useKeymap('highlightKeymap', {
  ToggleHighlight: {
    shortcuts: 'Mod-Shift-h',
    command: (ctx) => {
      const commands = ctx.get(commandsCtx);
      return () => commands.call(toggleHighlight.key);
    },
  },
});

export const nodes = [heading, paragraph, image, codeBlock, footnoteReference, footnoteDefinition, highlightSchema, toggleHighlight, highlightInputRule, highlightKeymap].flat();
