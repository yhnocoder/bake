export const options = {
  toc: { label: 'Table of contents style', type: 'enum', options: ['notes', 'tabs', 'dots', 'ticks'], default: 'notes' },
};

export const settings = {
  toc: { values: ['notes', 'tabs', 'dots', 'ticks'], default: { option: 'toc' }, control: 'list' },
  buttons: { values: ['autohide', 'always'], default: 'autohide', control: 'switch' },
};
