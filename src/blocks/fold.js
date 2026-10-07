export default {
  name: 'fold',
  form: 'container',
  label: '折叠',
  attributes: {},
  render: ({ label, children }) => ['details', { class: 'fold' }, [['summary', {}, label], ...children]],
};
