const WIDTH = 320;
const HEIGHT = 180;
const NAMESPACE = 'http://www.w3.org/2000/svg';

export default function preview(element) {
  const svg = document.createElementNS(NAMESPACE, 'svg');
  svg.setAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'display:block;width:100%;height:100%';
  const axis = shape('line', { x1: 0, y1: HEIGHT / 2, x2: WIDTH, y2: HEIGHT / 2, stroke: 'var(--line-2)', 'stroke-width': 1 });
  const wave = shape('path', { fill: 'none', stroke: 'var(--series-3)', 'stroke-width': 2.5, 'stroke-linejoin': 'round' });
  const label = shape('text', { x: WIDTH - 12, y: HEIGHT - 12, 'text-anchor': 'end', 'font-size': 11, 'font-family': 'var(--font-mono)', fill: 'var(--ink-3)' });
  svg.append(axis, wave, label);
  element.append(svg);
  let phase = 0;
  let frame = 0;
  let last;
  const draw = () => {
    const points = [];
    for (let x = 0; x <= WIDTH; x += 4) points.push(`${x},${(HEIGHT / 2 - 52 * Math.sin((x / WIDTH) * 4 * Math.PI + phase)).toFixed(1)}`);
    wave.setAttribute('d', `M${points.join('L')}`);
    label.textContent = `φ = ${(phase % (2 * Math.PI)).toFixed(2)}`;
  };
  const step = (now) => {
    if (last !== undefined) phase += Math.min(now - last, 50) * 0.003;
    last = now;
    draw();
    frame = requestAnimationFrame(step);
  };
  draw();
  return {
    start() {
      last = undefined;
      frame = requestAnimationFrame(step);
    },
    stop() {
      cancelAnimationFrame(frame);
    },
  };
}

function shape(name, attributes) {
  const node = document.createElementNS(NAMESPACE, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}
