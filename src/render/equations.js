import { visit } from 'unist-util-visit';
import '../math/node.js';
import { glyphDefinitions, renderFormula } from '../math/mathjax.js';
import { equationId, eqrefOnly, labelNames, labelPattern } from './equation-labels.js';

const eqref = /\\eqref\{/;

function numberEquations(tree, report) {
  const labels = new Map();
  let count = 0;
  visit(tree, 'math', (node) => {
    const names = labelNames(node.value);
    if (names.length === 0) return;
    const id = equationId(names[0]);
    const firstIsDuplicate = labels.has(names[0]);
    const numbers = [];
    for (const name of names) {
      const number = ++count;
      numbers.push(number);
      if (labels.has(name)) report(node, `Duplicate equation label ${name}`);
      else labels.set(name, { id, number });
    }
    let index = 0;
    node.data = { ...node.data, equationId: firstIsDuplicate ? undefined : id, tex: node.value.replace(labelPattern, () => `\\tag{${numbers[index++]}}`) };
  });
  return labels;
}

export async function renderEquations(tree, { macros, report }) {
  const labels = numberEquations(tree, report);
  const formulas = [];
  visit(tree, ['math', 'inlineMath'], (node) => {
    formulas.push(node);
  });
  const glyphIds = new Set();
  for (const node of formulas) {
    const reference = eqrefOnly.exec(node.value);
    if (reference) {
      const target = labels.get(reference[1]);
      if (target) node.data = { ...node.data, eqref: target };
      else report(node, `\\eqref target ${reference[1]} is not defined`);
      continue;
    }
    if (eqref.test(node.value)) {
      report(node, '\\eqref must be the only content of its formula');
      continue;
    }
    try {
      const { svg, glyphIds: used } = await renderFormula(node.data?.tex ?? node.value, node.type === 'math', macros);
      node.data = { ...node.data, svg };
      for (const id of used) glyphIds.add(id);
    } catch (error) {
      report(node, `Invalid TeX: ${error.message}`);
    }
  }
  return glyphDefinitions([...glyphIds]);
}
