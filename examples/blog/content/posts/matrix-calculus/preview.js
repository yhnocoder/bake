const EXPRESSIONS = ['2x', '0', 'y', 'x'];
const STAGE = 4000;

export default function preview(element) {
  element.style.fontFamily = 'var(--font-mono)';
  element.innerHTML = `<svg viewBox="0 0 320 180" aria-hidden="true" style="display:block;width:100%;height:100%">
    <text x="160" y="24" text-anchor="middle" font-size="13" fill="var(--ink-2)">f(x, y) = [x², xy]</text>
    <text x="48" y="96" font-size="20" fill="var(--ink-2)" font-style="italic">J =</text>
    <path d="M103 38H95V142H103 M263 38H271V142H263" fill="none" stroke="var(--ink-3)" stroke-width="1.5"/>
    ${EXPRESSIONS.map((expression, i) => {
      const x = 110 + (i % 2) * 78;
      const y = 41 + Math.floor(i / 2) * 52;
      return `<rect x="${x}" y="${y}" width="66" height="46" rx="6" fill="${i === 0 || i === 3 ? '#985b57' : '#c4b17b'}" fill-opacity=".18"/>
        <text x="${x + 33}" y="${y + 15}" text-anchor="middle" font-size="12" fill="var(--ink-2)">${expression}</text>
        <text class="entry" x="${x + 33}" y="${y + 36}" text-anchor="middle" font-size="18" fill="var(--ink)"></text>`;
    }).join('')}
    <line x1="110" y1="149" x2="254" y2="149" stroke="var(--line)" stroke-width="2"/>
    <circle class="x-point" cy="149" r="3.5" fill="#985b57"/>
    <text x="99" y="153" text-anchor="end" font-size="10" fill="var(--ink-3)">x</text>
    <line x1="285" y1="45" x2="285" y2="135" stroke="var(--line)" stroke-width="2"/>
    <circle class="y-point" cx="285" r="3.5" fill="#b49a58"/>
    <text x="285" y="35" text-anchor="middle" font-size="10" fill="var(--ink-3)">y</text>
    <text class="input-values" x="160" y="164" text-anchor="middle" font-size="11" fill="var(--ink-2)"></text>
    <text class="phase-label" x="160" y="177" text-anchor="middle" font-size="10" fill="var(--ink-3)"></text>
  </svg>`;
  const entries = element.querySelectorAll('.entry');
  const xPoint = element.querySelector('.x-point');
  const yPoint = element.querySelector('.y-point');
  const inputValues = element.querySelector('.input-values');
  const phaseLabel = element.querySelector('.phase-label');
  let elapsed = 0;
  let frame = 0;
  let last;
  const draw = () => {
    // Each four-second stage returns to 1 before the other variable starts moving.
    const stage = Math.floor(elapsed / STAGE) % 2;
    const moving = Math.cos(((elapsed % STAGE) / STAGE) * 2 * Math.PI);
    const x = stage === 0 ? moving : 1;
    const y = stage === 1 ? moving : 1;
    const values = [2 * x, 0, y, x];
    const format = (value) => (Math.abs(value) < 0.005 ? 0 : value).toFixed(2);
    entries.forEach((node, i) => {
      node.textContent = format(values[i]);
    });
    xPoint.setAttribute('cx', 182 + 72 * x);
    yPoint.setAttribute('cy', 90 - 45 * y);
    inputValues.textContent = `x = ${format(x)}    y = ${format(y)}`;
    phaseLabel.textContent = stage === 0 ? 'x 变化 · y 保持不变' : 'y 变化 · x 保持不变';
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
