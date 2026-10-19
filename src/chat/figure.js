export const FIGURE_STATES = ['idle', 'greet', 'waiting', 'answering', 'failed'];

const SVG = 'http://www.w3.org/2000/svg';
const SHAPES = [
  ['path', { class: 'bk-chat-figure-body', d: 'M4 13.2C4 8.3 7.6 4.6 12 4.6s8 3.7 8 8.6v3.4a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z' }],
  ['circle', { class: 'bk-chat-figure-eye', cx: '9.4', cy: '12.6', r: '1.15' }],
  ['circle', { class: 'bk-chat-figure-eye', cx: '14.6', cy: '12.6', r: '1.15' }],
  ['path', { class: 'bk-chat-figure-closed', d: 'M8.3 12.6h2.2M13.5 12.6h2.2' }],
  ['path', { class: 'bk-chat-figure-mouth', d: 'M10.7 15.5q1.3 0.9 2.6 0' }],
];

export function createFigure() {
  const element = document.createElementNS(SVG, 'svg');
  element.setAttribute('viewBox', '0 0 24 24');
  element.setAttribute('class', 'bk-chat-figure');
  element.setAttribute('aria-hidden', 'true');
  for (const [name, attributes] of SHAPES) {
    const shape = document.createElementNS(SVG, name);
    for (const [attribute, value] of Object.entries(attributes)) shape.setAttribute(attribute, value);
    element.append(shape);
  }
  const setState = (state) => {
    element.dataset.state = FIGURE_STATES.includes(state) ? state : 'idle';
  };
  element.addEventListener('animationend', () => {
    if (element.dataset.state === 'greet') setState('idle');
  });
  setState('idle');
  return { element, setState };
}
