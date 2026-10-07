export default {
  name: 'references',
  form: 'container',
  label: '参考文献',
  attributes: {},
  render: ({ children }) => ['ol', { class: 'references' }, children.find((child) => child.tagName === 'ul' || child.tagName === 'ol')?.children ?? []],
};
