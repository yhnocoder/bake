export const docContent = 'directive_lede? block+';
export const blockquoteContent = 'block+ directive_source?';

const contentRules = {
  directive_fold: 'directive_label block+',
  directive_bento: 'directive_card+',
  directive_references: 'directive_label? (bullet_list | ordered_list)',
};

const outsideBlockGroup = new Set(['directive_lede', 'directive_card', 'directive_source']);

export function containerContent(id) {
  return contentRules[id] ?? 'directive_label? block+';
}

export function labelRequired(id) {
  return containerContent(id).startsWith('directive_label ');
}

export function blockGroup(id) {
  return outsideBlockGroup.has(id) ? undefined : 'block';
}

export function checkOrder(node) {
  let previous = null;
  let ordered = true;
  node.forEach((child) => {
    if (child.type.name === 'directive_subtitle' && previous?.type.name !== 'heading') ordered = false;
    previous = child;
  });
  return ordered;
}
