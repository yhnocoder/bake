const COLOR = '#2a78d6';
const STAGE = 1200;
const LINKS = [
  { anchor: '#chain-rule', y: 34, height: 10 },
  { anchor: '#local-grad', y: 52, height: 22 },
  { anchor: '#vjp', y: 86, height: 10 },
  { anchor: '#topo-order', y: 112, height: 34 },
];

// Links from the syntax article on the left reach the headings and paragraphs of this article on the right, one after another.
export default function preview(element) {
  element.style.fontFamily = 'var(--font-mono)';
  element.innerHTML = `<svg viewBox="0 0 320 180" aria-hidden="true" style="display:block;width:100%;height:100%">
    <rect x="16" y="20" width="104" height="138" rx="6" fill="var(--surface)" stroke="var(--line)"/>
    <rect x="200" y="20" width="104" height="138" rx="6" fill="var(--surface)" stroke="var(--line)"/>
    ${LINKS.map((link, i) => `<rect class="source" x="26" y="${36 + i * 28}" width="84" height="12" rx="3" fill="${COLOR}"/>
      <rect x="26" y="${52 + i * 28}" width="60" height="4" rx="2" fill="var(--ink-3)" fill-opacity=".5"/>`).join('')}
    ${LINKS.map((link) => `<rect class="target" x="208" y="${link.y}" width="88" height="${link.height}" rx="3" fill="${COLOR}"/>`).join('')}
    <path class="arrow" fill="none" stroke="${COLOR}" stroke-width="2" pathLength="1" stroke-dasharray="1"/>
    <circle class="tip" r="3" fill="${COLOR}"/>
  </svg>
  <span style="position:absolute;right:10px;bottom:4px;font-size:calc(11px * var(--k));color:var(--ink-3)"></span>`;
  const sources = element.querySelectorAll('.source');
  const targets = element.querySelectorAll('.target');
  const arrow = element.querySelector('.arrow');
  const tip = element.querySelector('.tip');
  const label = element.querySelector('span');
  let elapsed = STAGE / 2;
  let frame = 0;
  let last;
  const draw = () => {
    const current = Math.floor(elapsed / STAGE) % LINKS.length;
    const progress = Math.min(1, (elapsed % STAGE) / 500);
    const link = LINKS[current];
    const fromY = 42 + current * 28;
    const toY = link.y + link.height / 2;
    arrow.setAttribute('d', `M110 ${fromY}C160 ${fromY} 150 ${toY} 208 ${toY}`);
    arrow.setAttribute('stroke-dashoffset', 1 - progress);
    const point = arrow.getPointAtLength(arrow.getTotalLength() * progress);
    tip.setAttribute('cx', point.x);
    tip.setAttribute('cy', point.y);
    sources.forEach((source, i) => source.setAttribute('fill-opacity', i === current ? 0.35 : 0.12));
    targets.forEach((target, i) => target.setAttribute('fill-opacity', i === current ? 0.25 * progress + 0.1 : 0.1));
    label.textContent = `/2026-10/syntax-linked/${link.anchor}`;
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
