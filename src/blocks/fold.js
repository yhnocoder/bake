export default {
  name: 'fold',
  form: 'container',
  label: '折叠',
  attributes: {},
  render: ({ children: [title, ...content] }) => ['details', { class: 'fold' }, [['summary', {}, title?.children ?? []], ...content]],
};
