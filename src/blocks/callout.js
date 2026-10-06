export default {
  name: 'callout',
  form: 'container',
  label: '提示框',
  attributes: {
    kind: { label: '类型', type: 'enum', options: ['note', 'tip', 'warning'], default: 'note' },
  },
};
