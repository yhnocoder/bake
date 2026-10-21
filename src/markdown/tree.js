export function walk(node, visit, parent = null) {
  if (visit(node, parent) === false) return;
  for (const child of [...(node.children ?? [])]) walk(child, visit, node);
}

export function walkWithSidenotes(article, tree, visit) {
  const entered = new Set();
  const step = (node) => {
    const result = visit(node);
    if (node.type === 'footnoteReference' && !entered.has(node.identifier)) {
      entered.add(node.identifier);
      walk(article.definitions.get(node.identifier), step);
    }
    return result;
  };
  walk(tree, step);
}
