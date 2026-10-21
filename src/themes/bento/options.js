export const options = {
  columns: { label: 'Card columns from 1000 pixels up', type: 'number', min: 1, max: 6, step: 1, default: 6 },
  rowHeight: { label: 'Height of one card row in pixels', type: 'number', min: 8, max: 120, step: 1, default: 24 },
};

export const headings = {
  width: { type: 'enum', options: ['body', 'wide', 'page'], depth: 2 },
  cols: { type: 'number', min: 1, max: 6, step: 1, depth: 2 },
  rows: { type: 'number', min: 1, max: 200, step: 1, depth: 2 },
};

export const blocks = {
  sticker: {
    cols: { type: 'number', min: 1, max: 6, step: 1 },
    rows: { type: 'number', min: 1, max: 200, step: 1 },
  },
  note: {
    cols: { type: 'number', min: 1, max: 6, step: 1 },
    rows: { type: 'number', min: 1, max: 200, step: 1 },
    color: { type: 'enum', options: ['yellow', 'green', 'blue', 'pink'] },
  },
};
