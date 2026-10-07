import { visit } from 'unist-util-visit';
import { visitParents } from 'unist-util-visit-parents';

const anchorTypes = new Set(['paragraph', 'heading', 'table', 'leafDirective']);

function takeDefinitions(node, definitions) {
  if (!node.children) return;
  node.children = node.children.filter((child) => {
    if (child.type !== 'footnoteDefinition') return true;
    if (!definitions.has(child.identifier)) definitions.set(child.identifier, child);
    return false;
  });
  for (const child of node.children) takeDefinitions(child, definitions);
}

function anchorOf(ancestors) {
  let index = ancestors.findLastIndex((ancestor) => anchorTypes.has(ancestor.type));
  if (index === -1) index = 1;
  if (ancestors[index].data?.directiveLabel) index -= 1;
  return { anchor: ancestors[index], container: ancestors[index - 1] };
}

export function placeSidenotes(tree, report) {
  const definitions = new Map();
  takeDefinitions(tree, definitions);
  for (const definition of definitions.values()) {
    visit(definition, 'footnoteReference', (reference, index, parent) => {
      report(reference, 'A sidenote cannot contain a footnote reference');
      parent.children.splice(index, 1);
      return index;
    });
  }
  const placements = new Map();
  let count = 0;
  visitParents(tree, 'footnoteReference', (reference, ancestors) => {
    const number = ++count;
    reference.data = { ...reference.data, sidenote: number };
    const parent = ancestors.at(-1);
    const previous = parent.children[parent.children.indexOf(reference) - 1];
    if (previous?.type === 'textDirective' && previous.name === 'span') {
      previous.data = { ...previous.data, hProperties: { dataSidenote: String(number) } };
    }
    const definition = definitions.get(reference.identifier);
    if (!definition) return;
    const { anchor, container } = anchorOf(ancestors);
    const placement = placements.get(anchor) ?? { container, notes: [] };
    placement.notes.push({ type: 'sidenote', number, children: definition.children, position: definition.position });
    placements.set(anchor, placement);
  });
  for (const [anchor, { container, notes }] of placements) {
    container.children.splice(container.children.indexOf(anchor) + 1, 0, ...notes);
  }
}
