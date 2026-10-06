export default {
  name: 'card',
  form: 'container',
  label: '卡片',
  attributes: {
    span: { label: '尺寸', type: 'string', default: '1x1' },
    title: { label: '标题', type: 'string' },
  },
};
