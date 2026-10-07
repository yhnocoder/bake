export default {
  name: 'span',
  form: 'text',
  label: '注释范围',
  attributes: {},
  render: ({ children }) => ['span', { class: 'sidenote-span' }, children],
};
