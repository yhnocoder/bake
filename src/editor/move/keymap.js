import { keymap } from '@milkdown/prose/keymap';
import { NodeSelection, TextSelection } from '@milkdown/prose/state';
import { $prose } from '@milkdown/utils';
import { applyBlockTransaction } from './apply.js';
import { draggableBlocks, planStep, unitAt } from './transactions.js';

function insertedAt(tr) {
  return tr.steps.at(-1).from;
}

function keepSelection(tr, selection, unit) {
  const shift = insertedAt(tr) - unit.from;
  const within = (pos) => pos >= unit.from && pos <= unit.to;
  if (selection instanceof NodeSelection) return tr.setSelection(NodeSelection.create(tr.doc, selection.from + shift));
  if (!(selection instanceof TextSelection)) return tr;
  if (within(selection.anchor) && within(selection.head)) return tr.setSelection(TextSelection.create(tr.doc, selection.anchor + shift, selection.head + shift));
  return tr.setSelection(TextSelection.create(tr.doc, selection.from + shift));
}

function step(direction) {
  return (state, _, view) => {
    const { selection } = state;
    const [pos] = draggableBlocks(state.doc, selection instanceof NodeSelection ? selection.from : -1, selection.from);
    if (pos === undefined) return true;
    const unit = unitAt(state, pos);
    const tr = planStep(state, unit, direction);
    if (tr) applyBlockTransaction(view, keepSelection(tr, selection, unit));
    return true;
  };
}

export const moveKeymap = $prose(() => keymap({ 'Mod-Shift-ArrowUp': step(-1), 'Mod-Shift-ArrowDown': step(1) }));
