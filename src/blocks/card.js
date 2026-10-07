export default {
  name: 'card',
  form: 'container',
  label: '卡片',
  attributes: {
    span: { label: '尺寸', type: 'string', default: '1x1' },
    title: { label: '标题', type: 'string' },
  },
  render: ({ attributes, children }) => {
    const [columns, rows] = attributes.span.split('x');
    const title = attributes.title === undefined ? [] : [['p', { class: 'card-title' }, [attributes.title]]];
    return ['section', { class: 'card', style: `grid-column: span ${columns}; grid-row: span ${rows}` }, [...title, ...children]];
  },
};
