import { visit } from 'unist-util-visit';

function takeDefinitions(node, definitions) {
  if (!node.children) return;
  node.children = node.children.filter((child) => {
    if (child.type !== 'footnoteDefinition') return true;
    const sameIdentifier = definitions.get(child.identifier) ?? [];
    definitions.set(child.identifier, [...sameIdentifier, child]);
    return false;
  });
  for (const child of node.children) takeDefinitions(child, definitions);
}

function referencedIdentifiers(node) {
  const identifiers = [];
  visit(node, 'footnoteReference', (reference) => {
    identifiers.push(reference.identifier);
  });
  return identifiers;
}

export function placeFootnoteDefinitions(tree) {
  const definitions = new Map();
  takeDefinitions(tree, definitions);
  const children = [];
  const placeReferencedBy = (node) => {
    for (const identifier of referencedIdentifiers(node)) {
      const definition = definitions.get(identifier)?.shift();
      if (!definition) continue;
      children.push(definition);
      placeReferencedBy(definition);
    }
  };
  for (const child of tree.children) {
    children.push(child);
    placeReferencedBy(child);
  }
  for (const remaining of definitions.values()) children.push(...remaining);
  tree.children = children;
}
