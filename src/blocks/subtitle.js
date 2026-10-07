export default {
  name: 'subtitle',
  form: 'leaf',
  label: '章节副标题',
  attributes: {},
  render: ({ children }) => ['p', { class: 'subtitle' }, children],
};
