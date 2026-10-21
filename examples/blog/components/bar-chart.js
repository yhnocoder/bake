import { niceTicks } from 'bake/kit';
import './lib/bar-chart.css';

export const params = {
  data: { label: '数据文件', type: 'file', default: '' },
};

export const layout = { width: 'body', height: 240 };

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export default class BarChart extends HTMLElement {
  connectedCallback() {
    this.update();
  }

  async update() {
    const source = this.params.data;
    let bars = [];
    try {
      if (source !== '') bars = await (await fetch(source)).json();
    } catch (error) {
      console.error(`bar-chart: ${source} cannot be loaded: ${error.message}`);
    }
    if (source === this.params.data) this.draw(bars);
  }

  draw(bars) {
    const max = Math.max(1, ...bars.map((bar) => bar.value));
    const step = niceTicks(0, max, 4)[1].value;
    const ticks = niceTicks(0, Math.ceil(max / step) * step, 4);
    const top = ticks.at(-1).value;
    const percent = (value) => `${(value / top) * 100}%`;
    const plot = element('div', 'bar-chart-plot');
    for (const tick of ticks) {
      const line = element('div', 'bar-chart-tick', tick.label);
      line.style.bottom = percent(tick.value);
      plot.append(line);
    }
    for (const bar of bars) {
      const column = element('div', 'bar-chart-column');
      const fill = element('div', 'bar-chart-bar');
      fill.style.height = percent(bar.value);
      fill.append(element('span', 'bar-chart-value', `${bar.value}${bar.unit ?? ''}`));
      column.append(fill, element('span', 'bar-chart-label', bar.label));
      plot.append(column);
    }
    plot.setAttribute('role', 'img');
    plot.setAttribute('aria-label', bars.map((bar) => `${bar.label} ${bar.value}${bar.unit ?? ''}`).join('，'));
    this.replaceChildren(plot);
  }
}
