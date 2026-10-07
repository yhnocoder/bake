import { commandsCtx } from '@milkdown/core';
import { markRule } from '@milkdown/prose';
import { toggleMark } from '@milkdown/prose/commands';
import { blockquoteSchema, codeBlockSchema, headingSchema, imageSchema, paragraphSchema } from '@milkdown/preset-commonmark';
import { footnoteDefinitionSchema, footnoteReferenceSchema } from '@milkdown/preset-gfm';
import { $command, $inputRule, $markSchema, $node, $useKeymap } from '@milkdown/utils';
import { imageAppearance } from '../render/image.js';
import { footnoteKey } from './footnote-labels.js';
import { blockquoteContent, docContent } from './structure.js';

const doc = $node('doc', () => ({
  content: docContent,
  attrs: { frontmatter: { default: null } },
  parseMarkdown: {
    match: (node) => node.type === 'root',
    runner: (state, node, type) => {
      const yaml = node.children.find((child) => child.type === 'yaml');
      state.openNode(type, { frontmatter: yaml ? yaml.value : null });
      state.next(node.children.filter((child) => child !== yaml));
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'doc',
    runner: (state, node) => {
      state.openNode('root');
      if (node.attrs.frontmatter !== null) state.addNode('yaml', undefined, node.attrs.frontmatter);
      const last = node.lastChild;
      state.next(last?.type.name === 'paragraph' && last.content.size === 0 ? node.content.cut(0, node.content.size - last.nodeSize) : node.content);
    },
  },
}));

const blockquote = blockquoteSchema.extendSchema((previous) => (ctx) => ({ ...previous(ctx), content: blockquoteContent }));

export function isEmptyDefinition(node) {
  return node.childCount === 1 && node.firstChild.type.name === 'paragraph' && node.firstChild.content.size === 0;
}


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

export const footnoteReference = footnoteReferenceSchema.extendSchema((previous) => (ctx) => {
  const base = previous(ctx);
  return {
    ...base,
    parseDOM: [{ tag: 'sup.sidenote-ref[data-label]', getAttrs: (dom) => ({ label: dom.dataset.label }) }],
    toDOM: (node) => ['sup', { class: 'sidenote-ref', 'data-label': node.attrs.label }, ['a', node.attrs.label]],
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, node) => {
        state.addNode('footnoteReference', undefined, undefined, { label: node.attrs.label, identifier: footnoteKey(node.attrs.label) });
      },
    },
  };
});

export const footnoteDefinition = footnoteDefinitionSchema.extendSchema((previous) => (ctx) => {
  const base = previous(ctx);
  return {
    ...base,
    parseDOM: [{ tag: 'aside.sidenote[data-label]', getAttrs: (dom) => ({ label: dom.dataset.label }), contentElement: '.sidenote-body' }],
    toDOM: (node) => ['aside', { class: 'sidenote', 'data-label': node.attrs.label }, ['div', { class: 'sidenote-body' }, 0]],
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, node) => {
        const props = { label: node.attrs.label, identifier: footnoteKey(node.attrs.label) };
        if (isEmptyDefinition(node)) {
          state.addNode('footnoteDefinition', [], undefined, props);
          return;
        }
        state.openNode('footnoteDefinition', undefined, props);
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

export const nodes = [doc, blockquote, heading, paragraph, image, codeBlock, footnoteReference, footnoteDefinition, highlightSchema, toggleHighlight, highlightInputRule, highlightKeymap].flat();
