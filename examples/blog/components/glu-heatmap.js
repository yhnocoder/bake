import { formatNumber, niceTicks } from 'bake/kit';
import { texToSvg } from 'bake/math';
import { silu } from './lib/activations.js';
import './lib/glu-heatmap.css';

export const params = {
  cells: { label: '网格数', type: 'number', min: 40, max: 400, step: 20, default: 160 },
  range: { label: '坐标范围 ±', type: 'number', min: 1, max: 10, step: 1, default: 4 },
  points: { label: '标注点', type: 'file', default: '' },
};

export const layout = { width: 'body', height: 360, narrowHeight: 400, frame: false };

const Y_TICKS_WIDTH = 36;
const TITLE_HEIGHT = 22;
const X_TICKS_HEIGHT = 18;
const X_TITLE_HEIGHT = 22;
const LEGEND_RIGHT_WIDTH = 80;
const LEGEND_BELOW_HEIGHT = 40;
const RIGHT_PADDING = 8;
const READOUT_OFFSET = 12;

const output = (g, u) => silu.f(g) * u;

function element(tag, className, children = []) {
  const node = document.createElement(tag);
  node.className = className;
  node.append(...children);
  return node;
}

function texSlot(className, text, tex, width) {
  const slot = element('span', 'glu-heat-tex');
  slot.style.width = width;
  texToSvg(tex).then(
    (svg) => slot.replaceChildren(svg),
    (error) => {
      slot.textContent = tex;
      console.error(`glu-heatmap: the TeX label "${tex}" cannot be typeset: ${error.message}`);
    },
  );
  return element('span', className, text ? [text, slot] : [slot]);
}

function readColor(context, color) {
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  return context.getImageData(0, 0, 1, 1).data.slice(0, 3);
}

function arrange(width, height) {
  const verticalSpace = height - TITLE_HEIGHT - X_TICKS_HEIGHT - X_TITLE_HEIGHT;
  const right = Math.min(verticalSpace, width - Y_TICKS_WIDTH - LEGEND_RIGHT_WIDTH);
  const below = Math.min(verticalSpace - LEGEND_BELOW_HEIGHT, width - Y_TICKS_WIDTH - RIGHT_PADDING);
  const side = Math.max(0, Math.floor(Math.max(right, below)));
  if (right >= below) return { side, columns: [Y_TICKS_WIDTH, side, LEGEND_RIGHT_WIDTH], rows: [TITLE_HEIGHT, side, X_TICKS_HEIGHT, X_TITLE_HEIGHT], below: false };
  return { side, columns: [Y_TICKS_WIDTH, side, RIGHT_PADDING], rows: [TITLE_HEIGHT, side, X_TICKS_HEIGHT, X_TITLE_HEIGHT, LEGEND_BELOW_HEIGHT], below: true };
}

export default class GluHeatmap extends HTMLElement {
  connectedCallback() {
    if (!this.chart) this.build();
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(this);
    document.addEventListener('bake:theme', this.draw);
    this.update();
  }

  disconnectedCallback() {
    this.resizeObserver.disconnect();
    document.removeEventListener('bake:theme', this.draw);
  }

  update() {
    if (!this.chart) return;
    const range = this.params.range;
    const limit = Math.abs(output(range, range));
    const ticks = niceTicks(-range, range, 4);
    const position = (value) => ((value + range) / (2 * range)) * 100 + '%';
    this.xTicks.replaceChildren(...ticks.map((tick) => this.tick(tick.label, 'left', position(tick.value))));
    this.yTicks.replaceChildren(...ticks.map((tick) => this.tick(tick.label, 'bottom', position(tick.value))));
    const bound = formatNumber(limit, limit < 10 ? 2 : 1);
    this.legendLabels.replaceChildren(...['+' + bound, '0', '−' + bound].map((label) => element('span', 'glu-heat-legend-label', [label])));
    this.canvas.setAttribute('aria-label', `GLU 输出热图，横轴门控分支 g 和纵轴线性分支 u 的范围都是 ±${range}，颜色范围是 ±${bound}`);
    this.limit = limit;
    this.draw();
    this.loadPoints();
  }

  async loadPoints() {
    const source = this.params.points;
    if (source === this.pointsSource) {
      this.placePoints();
      return;
    }
    this.pointsSource = source;
    this.points = [];
    if (source !== '') {
      try {
        const response = await fetch(source);
        const points = response.ok ? await response.json() : [];
        if (source !== this.pointsSource) return;
        this.points = points;
      } catch (error) {
        if (source !== this.pointsSource) return;
        console.error(`glu-heatmap: the points ${source} cannot be loaded: ${error.message}`);
      }
    }
    this.placePoints();
  }

  placePoints() {
    const range = this.params.range;
    const position = (value) => ((value + range) / (2 * range)) * 100 + '%';
    const inside = this.points.filter((point) => Math.abs(point.g) <= range && Math.abs(point.u) <= range);
    this.marks.replaceChildren(
      ...inside.map((point) => {
        const mark = element('span', point.g > 0 ? 'glu-heat-mark glu-heat-mark-left' : 'glu-heat-mark', [element('span', 'glu-heat-mark-label', [point.label])]);
        mark.style.left = position(point.g);
        mark.style.bottom = position(point.u);
        return mark;
      }),
    );
  }

  build() {
    this.canvas = element('canvas', 'glu-heat-canvas');
    this.canvas.setAttribute('role', 'img');
    this.readout = element('div', 'glu-heat-readout');
    this.readout.setAttribute('aria-hidden', 'true');
    this.xTicks = element('div', 'glu-heat-x-ticks');
    this.yTicks = element('div', 'glu-heat-y-ticks');
    this.legendLabels = element('div', 'glu-heat-legend-labels');
    this.legend = element('div', 'glu-heat-legend', [
      texSlot('glu-heat-legend-title', '', '\\mathrm{SiLU}(g)\\,u', '5.4em'),
      element('div', 'glu-heat-legend-bar'),
      this.legendLabels,
    ]);
    this.marks = element('div', 'glu-heat-marks');
    this.marks.setAttribute('aria-hidden', 'true');
    this.plot = element('div', 'glu-heat-plot', [this.canvas, this.marks, this.readout]);
    this.chart = element('div', 'glu-heat-chart', [
      texSlot('glu-heat-y-title', '线性分支 ', 'u', '0.8em'),
      this.yTicks,
      this.plot,
      this.xTicks,
      texSlot('glu-heat-x-title', '门控分支 ', 'g', '0.8em'),
      this.legend,
    ]);
    this.append(element('div', 'glu-heat', [this.chart]));
    this.canvas.addEventListener('pointermove', this.showReadout);
    this.canvas.addEventListener('pointerdown', this.showReadout);
    this.canvas.addEventListener('pointerleave', this.hideReadout);
    this.canvas.addEventListener('pointercancel', this.hideReadout);
  }

  tick(label, side, offset) {
    const node = element('span', 'glu-heat-tick', [label]);
    node.style[side] = offset;
    return node;
  }

  resize = () => {
    const layout = arrange(this.clientWidth, this.clientHeight);
    this.chart.classList.toggle('glu-heat-legend-below', layout.below);
    this.chart.style.gridTemplateColumns = layout.columns.map((size) => size + 'px').join(' ');
    this.chart.style.gridTemplateRows = layout.rows.map((size) => size + 'px').join(' ');
    this.side = layout.side;
    this.draw();
  };

  draw = () => {
    if (!this.side) return;
    const cells = this.params.cells;
    const range = this.params.range;
    const scale = devicePixelRatio || 1;
    this.canvas.width = Math.round(this.side * scale);
    this.canvas.height = Math.round(this.side * scale);
    const grid = document.createElement('canvas');
    grid.width = cells;
    grid.height = cells;
    const gridContext = grid.getContext('2d', { willReadFrequently: true });
    const style = getComputedStyle(this);
    const [low, middle, high] = ['--diverge-low', '--diverge-mid', '--diverge-high'].map((name) => readColor(gridContext, style.getPropertyValue(name)));
    const image = gridContext.createImageData(cells, cells);
    for (let row = 0; row < cells; row++) {
      const u = range - ((row + 0.5) * 2 * range) / cells;
      for (let column = 0; column < cells; column++) {
        const g = -range + ((column + 0.5) * 2 * range) / cells;
        const value = Math.max(-1, Math.min(1, output(g, u) / this.limit));
        const end = value < 0 ? low : high;
        const weight = Math.abs(value);
        const offset = (row * cells + column) * 4;
        for (let channel = 0; channel < 3; channel++) image.data[offset + channel] = middle[channel] + (end[channel] - middle[channel]) * weight;
        image.data[offset + 3] = 255;
      }
    }
    gridContext.putImageData(image, 0, 0);
    const context = this.canvas.getContext('2d');
    context.imageSmoothingEnabled = false;
    context.drawImage(grid, 0, 0, this.canvas.width, this.canvas.height);
  };

  showReadout = (event) => {
    const rect = this.canvas.getBoundingClientRect();
    const range = this.params.range;
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    const g = -range + (2 * range * x) / rect.width;
    const u = range - (2 * range * y) / rect.height;
    this.readout.replaceChildren(
      ...[
        ['g', formatNumber(g, 2)],
        ['u', formatNumber(u, 2)],
        ['SiLU(g)·u', formatNumber(output(g, u), 3)],
      ].map(([name, value]) => element('div', 'glu-heat-readout-row', [element('span', '', [name]), element('span', 'glu-heat-readout-number', [value])])),
    );
    const width = this.readout.offsetWidth;
    const height = this.readout.offsetHeight;
    const left = x + READOUT_OFFSET + width > rect.width ? x - READOUT_OFFSET - width : x + READOUT_OFFSET;
    const top = y + READOUT_OFFSET + height > rect.height ? y - READOUT_OFFSET - height : y + READOUT_OFFSET;
    this.readout.style.left = Math.max(0, Math.min(rect.width - width, left)) + 'px';
    this.readout.style.top = Math.max(0, Math.min(rect.height - height, top)) + 'px';
    this.readout.classList.add('glu-heat-readout-visible');
  };

  hideReadout = () => {
    this.readout.classList.remove('glu-heat-readout-visible');
  };
}
