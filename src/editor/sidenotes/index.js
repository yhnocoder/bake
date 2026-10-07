import { commandsCtx } from '@milkdown/core';
import { InputRule } from '@milkdown/prose/inputrules';
import { Fragment, Slice } from '@milkdown/prose/model';
import { Plugin, PluginKey, TextSelection } from '@milkdown/prose/state';
import { Transform } from '@milkdown/prose/transform';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import { $command, $inputRule, $prose, $remark, $useKeymap, $view } from '@milkdown/utils';
import { alignSidenotes } from '../../client/sidenotes.js';
import { placeFootnoteDefinitions } from '../../format/footnotes.js';
import { footnoteKey, nextFootnoteLabel } from '../footnote-labels.js';
import { footnoteDefinition, footnoteReference, isEmptyDefinition } from '../nodes.js';
import { fixSidenotes, numberSidenotes } from './placement.js';
import { DefinitionView, ReferenceView } from './views.js';

const sidenotesKey = new PluginKey('sidenotes');

function isDefinition(node) {
  return node.type.name === 'footnote_definition';
}

function definitionDepth($pos) {
  for (let depth = $pos.depth; depth > 0; depth--) if (isDefinition($pos.node(depth))) return depth;
  return null;
}

function usedKeys(doc) {
  const used = new Set();
  doc.descendants((node) => {
    if (node.type.name === 'footnote_reference' || isDefinition(node)) used.add(footnoteKey(node.attrs.label));
  });
  return used;
}

function insertSidenote(tr) {
  const { $from, $to } = tr.selection;
  const { footnote_reference: referenceType, footnote_definition: definitionType, paragraph } = tr.doc.type.schema.nodes;
  if (!$from.parent.inlineContent || !$from.parent.canReplaceWith($from.index(), $from.index(), referenceType)) return false;
  if (definitionDepth($from) !== null || definitionDepth($to) !== null) return false;
  const label = nextFootnoteLabel(usedKeys(tr.doc));
  tr.replaceSelectionWith(referenceType.create({ label }), false);
  const referencePos = tr.selection.from - 1;
  const index = tr.doc.resolve(referencePos).index(0);
  const earlier = numberSidenotes(tr.doc).references.filter((reference) => reference.index === index && reference.pos < referencePos).length;
  let pos = tr.doc.resolve(referencePos).after(1);
  for (let count = 0; count < earlier; count++) {
    const next = tr.doc.nodeAt(pos);
    if (!next || !isDefinition(next)) break;
    pos += next.nodeSize;
  }
  tr.insert(pos, definitionType.create({ label }, paragraph.create()));
  tr.setSelection(TextSelection.create(tr.doc, pos + 2));
  return true;
}

function atDefinitionEdge($pos, depth, edge) {
  for (let level = depth; level < $pos.depth; level++) {
    const last = $pos.node(level).childCount - 1;
    if ($pos.index(level) !== (edge === 'start' ? 0 : last)) return false;
  }
  return $pos.parentOffset === (edge === 'start' ? 0 : $pos.parent.content.size);
}

function cursorIn(state) {
  const { selection } = state;
  if (!selection.empty || !selection.$from.parent.isTextblock) return null;
  return selection.$from;
}

function removeEmptySidenote(state, dispatch, $from, depth) {
  const definition = $from.node(depth);
  if (!isEmptyDefinition(definition)) return true;
  const definitionPos = $from.before(depth);
  const reference = numberSidenotes(state.doc).references.find((entry) => entry.key === footnoteKey(definition.attrs.label));
  const tr = state.tr.delete(definitionPos, definitionPos + definition.nodeSize);
  if (reference) {
    const referencePos = tr.mapping.map(reference.pos);
    tr.delete(referencePos, referencePos + 1);
    tr.setSelection(TextSelection.create(tr.doc, referencePos));
  }
  dispatch?.(tr.scrollIntoView());
  return true;
}

function joinBackwardOverSidenotes(state, dispatch) {
  const $from = cursorIn(state);
  if (!$from || $from.parentOffset !== 0) return false;
  const depth = definitionDepth($from);
  if (depth !== null) return atDefinitionEdge($from, depth, 'start') && removeEmptySidenote(state, dispatch, $from, depth);
  const { doc } = state;
  const index = $from.index(0);
  if ($from.depth !== 1 || index === 0 || !isDefinition(doc.child(index - 1))) return false;
  let end = $from.before(1);
  let previous = index - 1;
  for (; previous >= 0 && isDefinition(doc.child(previous)); previous--) end -= doc.child(previous).nodeSize;
  if (previous < 0) return true;
  let target = doc.child(previous);
  while (!target.isTextblock) {
    if (target.isAtom || !target.lastChild) return true;
    end -= 1;
    target = target.lastChild;
  }
  const targetEnd = end - 1;
  const { content } = $from.parent;
  if (!target.canReplace(target.childCount, target.childCount, content)) return true;
  const tr = state.tr.delete($from.before(1), $from.after(1)).insert(targetEnd, content);
  tr.setSelection(TextSelection.create(tr.doc, targetEnd));
  dispatch?.(tr.scrollIntoView());
  return true;
}

function joinForwardOverSidenotes(state, dispatch) {
  const $from = cursorIn(state);
  if (!$from || $from.parentOffset !== $from.parent.content.size) return false;
  const depth = definitionDepth($from);
  if (depth !== null) return atDefinitionEdge($from, depth, 'end');
  const { doc } = state;
  if ($from.depth < 1 || !atDefinitionEdge($from, 1, 'end')) return false;
  const index = $from.index(0);
  if (index + 1 >= doc.childCount || !isDefinition(doc.child(index + 1))) return false;
  let start = $from.after(1);
  let next = index + 1;
  for (; next < doc.childCount && isDefinition(doc.child(next)); next++) start += doc.child(next).nodeSize;
  if (next >= doc.childCount) return true;
  let parent = doc;
  let childIndex = next;
  let source = doc.child(next);
  while (!source.isTextblock) {
    if (source.isAtom || !source.firstChild) return true;
    parent = source;
    childIndex = 0;
    start += 1;
    source = source.firstChild;
  }
  const target = $from.parent;
  if (!parent.canReplace(childIndex, childIndex + 1) || !target.canReplace(target.childCount, target.childCount, source.content)) return true;
  const tr = state.tr.delete(start, start + source.nodeSize).insert($from.pos, source.content);
  tr.setSelection(TextSelection.create(tr.doc, $from.pos));
  dispatch?.(tr.scrollIntoView());
  return true;
}

function decorate(doc) {
  const numbering = numberSidenotes(doc);
  const decorations = [];
  for (const { pos, number } of numbering.references) decorations.push(Decoration.node(pos, pos + 1, { 'data-number': String(number) }));
  for (const { pos, node, number } of numbering.definitions) {
    if (number !== null) decorations.push(Decoration.node(pos, pos + node.nodeSize, { 'data-number': String(number) }));
  }
  for (const { from, to, number } of numbering.spans) decorations.push(Decoration.inline(from, to, { class: 'sidenote-span', 'data-sidenote': String(number) }));
  return { numbering, decorations: DecorationSet.create(doc, decorations) };
}

function copyDefinitions(slice, view) {
  const copied = new Set();
  const referenced = new Set();
  slice.content.descendants((node) => {
    if (isDefinition(node)) {
      copied.add(footnoteKey(node.attrs.label));
      return false;
    }
    if (node.type.name === 'footnote_reference') referenced.add(footnoteKey(node.attrs.label));
    return true;
  });
  const { definitions } = sidenotesKey.getState(view.state).numbering;
  const missing = [...referenced].filter((key) => !copied.has(key)).flatMap((key) => definitions.find((definition) => definition.key === key)?.node ?? []);
  if (missing.length === 0) return slice;
  return new Slice(slice.content.append(Fragment.from(missing)), slice.openStart, 0);
}

function alignment(view) {
  let frame = null;
  const schedule = () => {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      const article = view.dom.closest('article');
      if (article) alignSidenotes(article);
    });
  };
  schedule();
  return {
    update: (current, previous) => {
      if (current.state.doc !== previous.doc) schedule();
    },
    destroy: () => cancelAnimationFrame(frame),
  };
}

const placement = $remark('sidenotePlacement', () => () => placeFootnoteDefinitions);

const sidenotesPlugin = $prose(
  () =>
    new Plugin({
      key: sidenotesKey,
      state: {
        init: (_, state) => decorate(state.doc),
        apply: (tr, value) => (tr.docChanged ? decorate(tr.doc) : value),
      },
      appendTransaction: (transactions, oldState, newState) => {
        if (!transactions.some((tr) => tr.docChanged)) return null;
        const replay = new Transform(oldState.doc);
        for (const tr of transactions) for (const step of tr.steps) replay.step(step);
        const count = replay.steps.length;
        fixSidenotes(replay, oldState.doc);
        if (replay.steps.length === count) return null;
        const fix = newState.tr;
        for (const step of replay.steps.slice(count)) fix.step(step);
        return fix;
      },
      props: {
        decorations: (state) => sidenotesKey.getState(state).decorations,
        transformCopied: copyDefinitions,
      },
      view: alignment,
    }),
);

export const insertSidenoteCommand = $command('InsertSidenote', () => () => (state, dispatch) => {
  const tr = state.tr;
  if (!insertSidenote(tr)) return false;
  dispatch?.(tr.scrollIntoView());
  return true;
});

const sidenoteInputRule = $inputRule(
  () =>
    new InputRule(/\[\^$/, (state, _, start, end) => {
      const tr = state.tr.delete(start, end);
      return insertSidenote(tr) ? tr : null;
    }),
);

const sidenoteKeymap = $useKeymap('sidenoteKeymap', {
  InsertSidenote: {
    shortcuts: 'Mod-Alt-f',
    command: (ctx) => () => ctx.get(commandsCtx).call(insertSidenoteCommand.key),
  },
  JoinBackwardOverSidenotes: {
    shortcuts: 'Backspace',
    priority: 100,
    command: () => joinBackwardOverSidenotes,
  },
  JoinForwardOverSidenotes: {
    shortcuts: 'Delete',
    priority: 100,
    command: () => joinForwardOverSidenotes,
  },
});

export const sidenotes = [
  placement,
  $view(footnoteReference.node, () => (node, _, __, decorations) => new ReferenceView(node, decorations)),
  $view(footnoteDefinition.node, () => (node, _, __, decorations) => new DefinitionView(node, decorations)),
  sidenotesPlugin,
  insertSidenoteCommand,
  sidenoteInputRule,
  sidenoteKeymap,
].flat();
