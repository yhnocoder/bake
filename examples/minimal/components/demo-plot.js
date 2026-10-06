const svgNamespace = 'http://www.w3.org/2000/svg';
const width = 320;
const height = 160;
const curves = {
  quadratic: { value: (x) => x * x, slope: (x) => 2 * x },
  quartic: { value: (x) => x ** 4 / 4, slope: (x) => x ** 3 },
};

function toPoint(x, y) {
  return `${(((x + 2) / 4) * width).toFixed(1)},${(height - (y / 4) * height).toFixed(1)}`;
}

function polyline(points, color) {
  const line = document.createElementNS(svgNamespace, 'polyline');
  line.setAttribute('points', points.join(' '));
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', '2');
  return line;
}

export default class DemoPlot extends HTMLElement {
  static properties = {
    x0: { label: 'x₀ 初始值', type: 'number', min: -2, max: 2, step: 0.01, default: 1.2 },
    showPath: { label: '显示路径', type: 'boolean', default: true },
    curve: { label: '函数', type: 'enum', options: ['quadratic', 'quartic'], default: 'quadratic' },
  };

  connectedCallback() {
    this.draw();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.draw();
  }

  draw() {
    const x0 = Number(this.getAttribute('x0') ?? DemoPlot.properties.x0.default);
    const showPath = (this.getAttribute('showPath') ?? String(DemoPlot.properties.showPath.default)) === 'true';
    const curve = curves[this.getAttribute('curve') ?? DemoPlot.properties.curve.default];
    const svg = document.createElementNS(svgNamespace, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const samples = Array.from({ length: 81 }, (_, index) => -2 + index * 0.05);
    svg.append(polyline(samples.map((x) => toPoint(x, curve.value(x))), 'currentColor'));
    if (showPath) {
      const path = [x0];
      for (let step = 0; step < 8; step++) path.push(path.at(-1) - 0.2 * curve.slope(path.at(-1)));
      svg.append(polyline(path.map((x) => toPoint(x, curve.value(x))), '#2f6fb3'));
    }
    this.querySelector(':scope > svg')?.remove();
    this.prepend(svg);
  }
}
