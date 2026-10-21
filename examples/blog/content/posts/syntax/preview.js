const COLOR = '#985b57';
const MATH_FONT = "'STIX Two Math', 'Cambria Math', 'Times New Roman', serif";
const SWEEP = 2600;
const HOLD = 1200;
const FADE = 7;
let previews = 0;

function source(y, parts, size = 11) {
  const spans = parts.map(([text, mark]) => `<tspan${mark ? ` fill="${COLOR}"` : ''}>${text}</tspan>`).join('');
  return `<text x="28" y="${y}" font-size="${size}" font-family="var(--font-mono)" fill="var(--ink-2)">${spans}</text>`;
}

// A soft edge moves down the page and back: above it the article is rendered, below it the Markdown is still source.
export default function preview(element) {
  const id = `syntax-preview-${(previews += 1)}`;
  element.innerHTML = `<svg viewBox="0 0 320 180" aria-hidden="true" style="display:block;width:100%;height:100%;font-family:var(--font-sans);font-variant-ligatures:none">
    <defs>
      <linearGradient id="${id}-page-fade" class="fade" gradientUnits="userSpaceOnUse" x1="0" x2="0"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
      <linearGradient id="${id}-source-fade" class="fade" gradientUnits="userSpaceOnUse" x1="0" x2="0"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient>
      <mask id="${id}-page" maskUnits="userSpaceOnUse" x="0" y="0" width="320" height="180"><rect width="320" height="180" fill="url(#${id}-page-fade)"/></mask>
      <mask id="${id}-source" maskUnits="userSpaceOnUse" x="0" y="0" width="320" height="180"><rect width="320" height="180" fill="url(#${id}-source-fade)"/></mask>
      <linearGradient id="${id}-glow" x2="0" y2="1"><stop offset="0" stop-color="${COLOR}" stop-opacity="0"/><stop offset=".5" stop-color="${COLOR}" stop-opacity=".08"/><stop offset="1" stop-color="${COLOR}" stop-opacity="0"/></linearGradient>
    </defs>
    <g mask="url(#${id}-source)">
      ${source(38, [['## ', 1], ['链式法则']], 12)}
      ${source(64, [['梯度由'], ['**', 1], ['局部导数'], ['**', 1], ['连乘得到。']])}
      ${source(98, [['$$', 1], ['\\frac{∂L}{∂x} = J^T\\frac{∂L}{∂y}'], ['$$', 1]], 10)}
      ${source(130, [[':::', 1], ['aside'], ['{title="阅读约定"}', 1]], 10)}
      ${source(145, [['向量都写成列向量。']], 10)}
      ${source(160, [[':::', 1]], 10)}
    </g>
    <g mask="url(#${id}-page)">
      <rect width="320" height="180" fill="var(--surface)"/>
      <text x="28" y="40" font-size="18" font-weight="700" font-family="var(--font-heading)" fill="var(--ink)">链式法则</text>
      <text x="28" y="64" font-size="12" fill="var(--ink-2)">梯度由<tspan font-weight="700" fill="var(--ink)">局部导数</tspan>连乘得到。</text>
      <g font-family="${MATH_FONT}" font-size="13" fill="var(--ink)" text-anchor="middle">
        <text x="40" y="91" font-style="italic">∂L</text>
        <line x1="30" y1="95" x2="50" y2="95" stroke="var(--ink)"/>
        <text x="40" y="108" font-style="italic">∂x</text>
        <text x="72" y="99">= <tspan font-style="italic">J</tspan><tspan font-size="9" dy="-5">T</tspan></text>
        <text x="104" y="91" font-style="italic">∂L</text>
        <line x1="94" y1="95" x2="114" y2="95" stroke="var(--ink)"/>
        <text x="104" y="108" font-style="italic">∂y</text>
      </g>
      <rect x="28" y="118" width="264" height="48" rx="8" fill="var(--surface-2)"/>
      <text x="42" y="135" font-size="8.5" font-weight="600" letter-spacing=".04em" font-family="var(--font-ui)" fill="var(--ink-2)">阅读约定</text>
      <text x="42" y="154" font-size="12" fill="var(--ink)">向量都写成列向量。</text>
    </g>
    <rect class="glow" width="320" height="${4 * FADE}" fill="url(#${id}-glow)"/>
  </svg>`;
  const fades = element.querySelectorAll('.fade');
  const glow = element.querySelector('.glow');
  let elapsed = HOLD + SWEEP * 0.448;
  let frame = 0;
  let last;
  const draw = () => {
    const time = elapsed % (2 * (SWEEP + HOLD));
    const down = time < HOLD ? 0 : time < HOLD + SWEEP ? (time - HOLD) / SWEEP : 1;
    const phase = time < 2 * HOLD + SWEEP ? down : 1 - (time - 2 * HOLD - SWEEP) / SWEEP;
    const eased = phase < 0.5 ? 2 * phase * phase : 1 - (-2 * phase + 2) ** 2 / 2;
    const y = -FADE + eased * (180 + 2 * FADE);
    fades.forEach((fade) => {
      fade.setAttribute('y1', y - FADE);
      fade.setAttribute('y2', y + FADE);
    });
    glow.setAttribute('y', y - 2 * FADE);
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
