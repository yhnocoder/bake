const labels = { note: '说明', tip: '提示', warning: '注意' };

export default {
  name: 'callout',
  form: 'container',
  label: '提示框',
  attributes: {
    kind: { label: '类型', type: 'enum', options: ['note', 'tip', 'warning'], default: 'note' },
  },
  render: ({ attributes, label, children }) => [
    'aside',
    { class: `callout ${attributes.kind}` },
    [['p', { class: 'callout-label' }, label ?? [labels[attributes.kind]]], ...children],
  ],
};
