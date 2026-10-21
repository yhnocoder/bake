const WIDTH = 320;
const HEIGHT = 180;
const X = (x) => WIDTH / 2 + x * 34;
const Y = (y) => HEIGHT * 0.74 - y * 24;

// SiLU_β(x) = x·σ(βx), with β moving between 0.5 and 8; the larger β, the closer the curve is to ReLU, drawn dashed.
export default function preview(element) {
  element.style.fontFamily = 'var(--font-mono)';
  element.innerHTML = `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" aria-hidden="true" style="display:block;width:100%;height:100%">
    <line x1="0" y1="${Y(0)}" x2="${WIDTH}" y2="${Y(0)}" stroke="var(--line)"/>
    <line x1="${X(0)}" y1="0" x2="${X(0)}" y2="${HEIGHT}" stroke="var(--line)"/>
    <path d="M0 ${Y(0)} H${X(0)} L${WIDTH} ${Y(WIDTH / 2 / 34)}" fill="none" stroke="var(--ink-3)" stroke-dasharray="3 3"/>
    <path class="curve" fill="none" stroke="#1baf7a" stroke-width="2.5" stroke-linejoin="round"/>
  </svg>
  <span style="position:absolute;right:10px;bottom:8px;font-size:calc(11px * var(--k));color:var(--ink-3)"></span>`;
  const curve = element.querySelector('.curve');
  const label = element.querySelector('span');
  let t = 0;
  let frame = 0;
  const draw = (beta) => {
    let d = '';
    for (let x = -4.7; x <= 4.7; x += 0.1) d += `${d ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(x / (1 + Math.exp(-beta * x))).toFixed(1)} `;
    curve.setAttribute('d', d);
    label.textContent = `SiLU  β = ${beta.toFixed(2)}`;
  };
  const step = () => {
    t += 0.02;
    draw(0.5 + (7.5 * (1 - Math.cos(t))) / 2);
    frame = requestAnimationFrame(step);
  };
  draw(1);
  return {
    start() {
      step();
    },
    stop() {
      cancelAnimationFrame(frame);
    },
  };
}
