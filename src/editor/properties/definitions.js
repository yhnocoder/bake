import { attributeError, headingAttributes, imageAttributes } from '../../format/attributes.js';
import { directiveAttributeError } from '../../format/validate.js';

export function attributeDefinitions({ blocks, components }) {
  const withAttributes = blocks.filter((block) => Object.keys(block.attributes ?? {}).length > 0);
  const byType = new Map(withAttributes.map((block) => [`directive_${block.name}`, block]));
  const directive = (name, title, properties) => ({
    title,
    properties,
    empty: {},
    error: (key, value) => directiveAttributeError(name, key, value, properties),
  });
  const fixed = (kind, title, properties) => ({
    title,
    properties,
    empty: null,
    error: (key, value) => attributeError(kind, key, value),
  });
  return {
    node(node) {
      if (node.type.name === 'component') return directive(node.attrs.name, node.attrs.name, components[node.attrs.name] ?? {});
      if (node.type.name === 'heading') return fixed('heading', '标题', headingAttributes);
      if (node.type.name === 'image') return fixed('image', '图片', imageAttributes);
      const block = byType.get(node.type.name);
      return block ? directive(block.name, block.label, block.attributes) : null;
    },
    mark(mark) {
      const block = byType.get(mark.type.name);
      return block ? directive(block.name, block.label, block.attributes) : null;
    },
  };
}
