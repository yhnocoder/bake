import { visit } from 'unist-util-visit';
import { glyphDefinitions, renderFormula } from './math.js';

const label = /\\label\{([^}]*)\}/g;
const eqrefOnly = /^\s*\\eqref\{([^}]*)\}\s*$/;
const eqref = /\\eqref\{/;

function equationId(name) {
  return name.replaceAll(':', '-');
}

function numberEquations(tree) {
  const labels = new Map();
  let count = 0;
  visit(tree, 'math', (node) => {
    const names = [...node.value.matchAll(label)].map((match) => match[1]);
    if (names.length === 0) return;
    const numbers = [];
    for (const name of names) {
      const number = ++count;
      numbers.push(number);
      if (!labels.has(name)) labels.set(name, { id: equationId(name), number });
    }
    let index = 0;
    node.data = { ...node.data, equationId: equationId(names[0]), tex: node.value.replace(label, () => `\\tag{${numbers[index++]}}`) };
  });
  return labels;
}

export async function renderEquations(tree, { macros, report }) {
  const labels = numberEquations(tree);
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
