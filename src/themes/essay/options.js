export const options = {
  toc: { label: 'Table of contents style', type: 'enum', options: ['notes', 'dots', 'ticks'], default: 'notes' },
};

export const settings = {
  toc: { values: ['notes', 'dots', 'ticks'], default: { option: 'toc' }, control: 'list' },
  buttons: { values: ['autohide', 'always'], default: 'autohide', control: 'switch' },
};

export const headings = {
  toc: { type: 'text' },
};
