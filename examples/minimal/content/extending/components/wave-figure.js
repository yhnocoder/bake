import { animate, layoutText, renderMath } from 'bake/runtime';

const svgNamespace = 'http://www.w3.org/2000/svg';
const width = 360;
const height = 200;
const plotLeft = 24;
const plotWidth = 200;
const axisY = 100;
const wavelength = 80;
const noteLeft = 240;
const noteWidth = 112;
const noteLineHeight = 20;
const note = '波形向左移动半个周期后停下，振幅由属性 amplitude 决定，这段文字由 layoutText 断行。';

function svgElement(name, attributes) {
  const element = document.createElementNS(svgNamespace, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function wavePath(amplitude) {
  const points = [];
  for (let x = 0; x <= plotWidth + wavelength; x += 2) {
    const y = axisY - amplitude * 60 * Math.sin((2 * Math.PI * x) / wavelength);
    points.push(`${(plotLeft + x).toFixed(1)},${y.toFixed(1)}`);
  }
  return `M${points.join(' L')}`;
}

export default class WaveFigure extends HTMLElement {
  static properties = {
    amplitude: { label: '振幅', type: 'number', min: 0.2, max: 1, step: 0.1, default: 0.6 },
  };

  connectedCallback() {
    this.draw();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.draw();
  }

  draw() {
    const amplitude = Number(this.getAttribute('amplitude') ?? WaveFigure.properties.amplitude.default);
    const svg = svgElement('svg', { viewBox: `0 0 ${width} ${height}`, class: 'wave-figure' });
    const clip = svgElement('clipPath', { id: 'wave-figure-clip' });
    clip.append(svgElement('rect', { x: plotLeft, y: 0, width: plotWidth, height }));
    svg.append(clip);
    svg.append(svgElement('line', { x1: plotLeft, y1: axisY, x2: plotLeft + plotWidth, y2: axisY, stroke: 'currentColor', 'stroke-width': 1 }));
    svg.append(svgElement('line', { x1: plotLeft, y1: 20, x2: plotLeft, y2: height - 20, stroke: 'currentColor', 'stroke-width': 1 }));
    const clipped = svgElement('g', { 'clip-path': 'url(#wave-figure-clip)' });
    const wave = svgElement('path', { d: wavePath(amplitude), fill: 'none', stroke: 'var(--color-accent)', 'stroke-width': 2, class: 'wave' });
    clipped.append(wave);
    svg.append(clipped);
    this.querySelector(':scope > svg')?.remove();
    this.prepend(svg);
    this.animation = animate(wave, { x: [0, -wavelength / 2] }, { duration: 2, ease: 'easeInOut' });
    this.drawNote(svg);
    this.drawFormula(svg);
  }

  async drawNote(svg) {
    await document.fonts.ready;
    const font = `14px ${getComputedStyle(this).fontFamily}`;
    const { lines } = layoutText({ text: note, font, width: noteWidth, lineHeight: noteLineHeight });
    const text = svgElement('text', { class: 'wave-note', 'font-size': 14, fill: 'currentColor' });
    lines.forEach((line, index) => {
      const span = svgElement('tspan', { x: noteLeft, y: 40 + index * noteLineHeight });
      span.textContent = line.text;
      text.append(span);
    });
    svg.append(text);
  }

  async drawFormula(svg) {
    const formula = await renderMath('y = A \\sin\\left(\\frac{2\\pi x}{\\lambda}\\right),\\ x \\in \\R');
    const holder = svgElement('svg', { x: plotLeft + 8, y: 8, overflow: 'visible', class: 'wave-formula' });
    holder.append(formula);
    svg.append(holder);
  }
}
