export default {
  name: 'shape',
  form: 'text',
  label: '形状',
  attributes: {
    kind: { label: '形状', type: 'enum', options: ['scalar', 'row', 'column', 'matrix'], default: 'scalar' },
  },
  render: ({ attributes, children }) => ['span', { class: `math-shape ${attributes.kind}` }, children],
};
