const WIDTH = 320;
const HEIGHT = 180;
const X = (x) => WIDTH / 2 + 40 + x * 36;
const Y = (y) => HEIGHT * 0.72 - y * 30;
const FUNCTIONS = [
  { name: 'ReLU', color: '#2a78d6', f: (x) => Math.max(0, x) },
  { name: 'GELU', color: '#eb6834', f: (x) => 0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x ** 3))) },
  { name: 'SiLU', color: '#1baf7a', f: (x) => x / (1 + Math.exp(-x)) },
];

// A vertical line sweeps the input across the three curves, and the legend shows each output at that input.
export default function preview(element) {
  element.style.fontFamily = 'var(--font-mono)';
  const curve = ({ f }) => {
    let d = '';
    for (let x = -4.4; x <= 3.3; x += 0.1) d += `${d ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(f(x)).toFixed(1)} `;
    return d;
  };
  element.innerHTML = `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" aria-hidden="true" style="display:block;width:100%;height:100%">
    <line x1="0" y1="${Y(0)}" x2="${WIDTH}" y2="${Y(0)}" stroke="var(--line)"/>
    <line x1="${X(0)}" y1="0" x2="${X(0)}" y2="${HEIGHT}" stroke="var(--line)"/>
    ${FUNCTIONS.map((fn) => `<path d="${curve(fn)}" fill="none" stroke="${fn.color}" stroke-width="2" stroke-linejoin="round"/>`).join('')}
    <line class="sweep" y1="0" y2="${HEIGHT}" stroke="var(--ink-3)" stroke-dasharray="3 3"/>
    ${FUNCTIONS.map((fn) => `<circle class="dot" r="3.5" fill="${fn.color}" stroke="var(--surface-2)" stroke-width="1.5"/>`).join('')}
    ${FUNCTIONS.map((fn, i) => `<text class="value" x="14" y="${24 + i * 17}" font-size="12" fill="${fn.color}"></text>`).join('')}
  </svg>
  <span style="position:absolute;right:10px;bottom:8px;font-size:calc(11px * var(--k));color:var(--ink-3)"></span>`;
  const sweep = element.querySelector('.sweep');
  const dots = element.querySelectorAll('.dot');
  const values = element.querySelectorAll('.value');
  const label = element.querySelector('span');
  let elapsed = 900;
  let frame = 0;
  let last;
  const draw = () => {
    const x = -0.6 + 2.6 * Math.sin(elapsed / 1500);
    sweep.setAttribute('x1', X(x));
    sweep.setAttribute('x2', X(x));
    FUNCTIONS.forEach(({ name, f }, i) => {
      dots[i].setAttribute('cx', X(x));
      dots[i].setAttribute('cy', Y(f(x)));
      values[i].textContent = `${name.padEnd(5)}${f(x).toFixed(2).padStart(6)}`;
    });
    label.textContent = `x = ${x.toFixed(2)}`;
  };
  const step = (now) => {
    if (last !== undefined) elapsed += Math.min(now - last, 50);
    last = now;
    draw();
    frame = requestAnimationFrame(step);
  };
  draw();
  return {
    start() {
      cancelAnimationFrame(frame);
      last = undefined;
      frame = requestAnimationFrame(step);
    },
    stop() {
      cancelAnimationFrame(frame);
    },
  };
}
