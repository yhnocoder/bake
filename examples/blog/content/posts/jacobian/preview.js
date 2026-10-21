const CENTER_X = 100;
const CENTER_Y = 90;
const SCALE = 28;
const AMOUNT = 0.5;
const FREQUENCY = 1.2;
const ARROW = 0.6;
const COLUMN_1 = '#2a78d6';
const COLUMN_2 = '#eda100';

const f = (x, y) => [x + AMOUNT * Math.sin(FREQUENCY * y), y + AMOUNT * Math.sin(FREQUENCY * x)];
const jacobian = (x, y) => [
  [1, AMOUNT * FREQUENCY * Math.cos(FREQUENCY * y)],
  [AMOUNT * FREQUENCY * Math.cos(FREQUENCY * x), 1],
];
const screen = ([x, y]) => [CENTER_X + x * SCALE, CENTER_Y - y * SCALE];

// A point circles through the bent grid of f; the two columns of its Jacobian are drawn as arrows at its image.
export default function preview(element) {
  element.style.fontFamily = 'var(--font-mono)';
  const grid = [];
  for (let u = -2; u <= 2; u += 0.5) {
    for (const along of [(t) => [u, t], (t) => [t, u]]) {
      let d = '';
      for (let t = -2; t <= 2.001; t += 0.2) d += `${d ? 'L' : 'M'}${screen(f(...along(t))).map((value) => value.toFixed(1)).join(' ')} `;
      grid.push(`<path d="${d}" fill="none" stroke="var(--line)"/>`);
    }
  }
  element.innerHTML = `<svg viewBox="0 0 320 180" aria-hidden="true" style="display:block;width:100%;height:100%">
    ${grid.join('')}
    <path class="cell" fill="${COLUMN_1}" fill-opacity=".15"/>
    <line class="column-1" stroke="${COLUMN_1}" stroke-width="2.5" stroke-linecap="round"/>
    <line class="column-2" stroke="${COLUMN_2}" stroke-width="2.5" stroke-linecap="round"/>
    <circle class="point" r="3.5" fill="var(--ink)"/>
    <text x="265" y="34" text-anchor="middle" font-size="12" fill="var(--ink-2)">f: ℝ² → ℝ²</text>
    <text x="180" y="96" font-size="16" fill="var(--ink-2)" font-style="italic">J =</text>
    <path d="M221 66H216V114H221 M309 66H314V114H309" fill="none" stroke="var(--ink-3)" stroke-width="1.5"/>
    ${[0, 1].flatMap((row) => [0, 1].map((column) => `<text class="entry" x="${243 + column * 44}" y="${85 + row * 22}" text-anchor="middle" font-size="13" fill="${column === 0 ? COLUMN_1 : COLUMN_2}"></text>`)).join('')}
    <text class="determinant" x="265" y="140" text-anchor="middle" font-size="11" fill="var(--ink-2)"></text>
  </svg>`;
  const cell = element.querySelector('.cell');
  const columns = [element.querySelector('.column-1'), element.querySelector('.column-2')];
  const point = element.querySelector('.point');
  const entries = element.querySelectorAll('.entry');
  const determinant = element.querySelector('.determinant');
  let elapsed = 0;
  let frame = 0;
  let last;
  const draw = () => {
    const angle = elapsed / 2000;
    const x = Math.cos(angle);
    const y = Math.sin(angle);
    const [px, py] = f(x, y);
    const J = jacobian(x, y);
    const tips = [0, 1].map((column) => screen([px + ARROW * J[0][column], py + ARROW * J[1][column]]));
    const [sx, sy] = screen([px, py]);
    const far = screen([px + ARROW * (J[0][0] + J[0][1]), py + ARROW * (J[1][0] + J[1][1])]);
    cell.setAttribute('d', `M${sx} ${sy}L${tips[0].join(' ')}L${far.join(' ')}L${tips[1].join(' ')}Z`);
    columns.forEach((line, i) => {
      line.setAttribute('x1', sx);
      line.setAttribute('y1', sy);
      line.setAttribute('x2', tips[i][0]);
      line.setAttribute('y2', tips[i][1]);
    });
    point.setAttribute('cx', sx);
    point.setAttribute('cy', sy);
    entries.forEach((entry, i) => {
      entry.textContent = J[Math.floor(i / 2)][i % 2].toFixed(2);
    });
    determinant.textContent = `det J = ${(J[0][0] * J[1][1] - J[0][1] * J[1][0]).toFixed(2)}`;
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
