export default {
  name: 'margin',
  form: 'container',
  label: '边注',
  attributes: {},
  render: ({ children }) => ['aside', { class: 'sidenote unnumbered' }, children],
};
