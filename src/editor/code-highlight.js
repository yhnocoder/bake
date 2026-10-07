import { Plugin, PluginKey } from '@milkdown/prose/state';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import { $prose } from '@milkdown/utils';
import { showMessage } from '../dev/status.js';

export const codeHighlightKey = new PluginKey('bake-code-highlight');

function codeBlocks(doc) {
  const blocks = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'code_block') blocks.push({ node, pos });
    return !node.isTextblock;
  });
  return blocks;
}

function decorationKey(decoration) {
  return `${decoration.from}:${decoration.to}:${decoration.spec.unknownLanguage ? 'unknown' : decoration.spec.style}`;
}

function createHighlighting() {
  const results = new WeakMap();
  const requested = new Set();
  const loaded = new Set();
  let highlighting = null;
  let shiki = null;

  function result(node) {
    if (results.has(node)) return results.get(node);
    const lang = node.attrs.language;
    let computed;
    if (!lang) computed = { ranges: [], unknown: false };
    else if (!highlighting) return null;
    else {
      const kind = highlighting.languageKind(lang);
      if (kind === 'plain') computed = { ranges: [], unknown: false };
      else if (kind === 'unknown') computed = { ranges: [], unknown: true };
      else if (!loaded.has(lang)) return null;
      else {
        const ranges = [];
        const recorder = {
          span(hast, line, col, lineElement, token) {
            ranges.push({ from: token.offset, to: token.offset + token.content.length, style: hast.properties.style });
          },
        };
        highlighting.codeToLines(shiki, node.textContent, lang, [recorder]);
        computed = { ranges, unknown: false };
      }
    }
    results.set(node, computed);
    return computed;
  }

  function blockDecorations({ node, pos }) {
    const computed = result(node);
    if (!computed) return [];
    const decorations = computed.ranges.map(({ from, to, style }) => Decoration.inline(pos + 1 + from, pos + 1 + to, { style }, { style }));
    if (computed.unknown) decorations.push(Decoration.node(pos, pos + node.nodeSize, {}, { unknownLanguage: true }));
    return decorations;
  }

  function create(doc) {
    const blocks = codeBlocks(doc);
    return { blocks, decorations: DecorationSet.create(doc, blocks.flatMap(blockDecorations)) };
  }

  function apply(tr, prev) {
    if (tr.getMeta(codeHighlightKey)) return create(tr.doc);
    if (!tr.docChanged) return prev;
    let decorations = prev.decorations.map(tr.mapping, tr.doc);
    const previous = new Map();
    const stale = [];
    for (const { node, pos } of prev.blocks) {
      const mapped = tr.mapping.mapResult(pos, 1);
      if (!mapped.deleted) previous.set(mapped.pos, node);
      if (mapped.deleted || tr.doc.nodeAt(mapped.pos)?.type.name !== 'code_block') stale.push({ from: mapped.pos, to: tr.mapping.map(pos + node.nodeSize, -1) });
    }
    const blocks = codeBlocks(tr.doc);
    const remove = [];
    const add = [];
    const within = (from, to) => decorations.find(from, to).filter((decoration) => decoration.from >= from && decoration.to <= to);
    const inCodeBlock = (decoration) => (decoration.spec.unknownLanguage ? tr.doc.nodeAt(decoration.from) : tr.doc.resolve(decoration.from).parent)?.type.name === 'code_block';
    for (const { from, to } of stale) {
      if (from < to) remove.push(...within(from, to).filter((decoration) => !inCodeBlock(decoration)));
    }
    for (const block of blocks) {
      if (previous.get(block.pos) === block.node) continue;
      const wanted = blockDecorations(block);
      const wantedKeys = new Set(wanted.map(decorationKey));
      const existing = within(block.pos, block.pos + block.node.nodeSize);
      const existingKeys = new Set(existing.map(decorationKey));
      remove.push(...existing.filter((decoration) => !wantedKeys.has(decorationKey(decoration))));
      add.push(...wanted.filter((decoration) => !existingKeys.has(decorationKey(decoration))));
    }
    if (remove.length > 0) decorations = decorations.remove(remove);
    if (add.length > 0) decorations = decorations.add(tr.doc, add);
    return { blocks, decorations };
  }

  async function load(view, languages, isDestroyed) {
    try {
      highlighting ??= await import('../render/highlighter.js');
    } catch {
      showMessage('代码高亮加载失败');
      return;
    }
    const known = languages.filter((lang) => highlighting.languageKind(lang) === 'known');
    const loads = await Promise.allSettled(known.map((lang) => highlighting.loadLanguage(lang)));
    for (const [index, lang] of known.entries()) {
      if (loads[index].status === 'fulfilled') loaded.add(lang);
    }
    if (loads.some(({ status }) => status === 'rejected')) showMessage('代码高亮加载失败');
    if (loaded.size > 0) shiki = await highlighting.highlighter();
    if (!isDestroyed()) view.dispatch(view.state.tr.setMeta(codeHighlightKey, true));
  }

  function request(view, isDestroyed) {
    const languages = [];
    for (const { node } of codeHighlightKey.getState(view.state).blocks) {
      const lang = node.attrs.language;
      if (lang && !requested.has(lang)) {
        requested.add(lang);
        languages.push(lang);
      }
    }
    if (languages.length > 0) load(view, languages, isDestroyed);
  }

  return new Plugin({
    key: codeHighlightKey,
    state: { init: (_, state) => create(state.doc), apply },
    props: { decorations: (state) => codeHighlightKey.getState(state).decorations },
    view(view) {
      let destroyed = false;
      const isDestroyed = () => destroyed;
      request(view, isDestroyed);
      return {
        update: (view) => request(view, isDestroyed),
        destroy: () => {
          destroyed = true;
        },
      };
    },
  });
}

export const codeHighlight = $prose(createHighlighting);
