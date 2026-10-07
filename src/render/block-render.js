export function withDefaults(attributes, definitions) {
  const defaults = Object.entries(definitions ?? {}).filter(([, property]) => property.default !== undefined);
  return { ...Object.fromEntries(defaults.map(([key, property]) => [key, String(property.default)])), ...attributes };
}

export function isDefault(value, property) {
  if (property?.default === undefined) return false;
  if (property.type === 'number') return Number(value) === property.default;
  return value === String(property.default);
}

export function blockRender(block, name, form) {
  if (block?.render) return block.render;
  const tagName = form === 'text' ? 'span' : 'div';
  return ({ attributes, label, children }) => [
    tagName,
    { class: name, ...Object.fromEntries(Object.entries(attributes).map(([key, value]) => [`data-${key}`, value])) },
    label ? [['p', {}, label], ...children] : children,
  ];
}
