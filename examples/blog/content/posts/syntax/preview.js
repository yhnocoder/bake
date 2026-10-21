const COLOR = '#985b57';
const NAMESPACE = 'http://www.w3.org/2000/svg';
const CHARACTER = 55;
const REVEAL = 300;
const HOLD = 1800;
const FADE = 250;
const SOURCE_X = 46;
const INK = { mark: COLOR, text: 'var(--ink)', attribute: 'var(--ink-3)' };

// Each example is the Markdown of one kind of block, typed out line by line, followed by the page Bake makes of it.
const EXAMPLES = [
  {
    source: [
      [[':::', 'mark'], ['aside', 'text'], ['{title="阅读约定"}', 'attribute']],
      [['向量都写成列向量。', 'text']],
      [[':::', 'mark']],
    ],
    page: `<rect x="40" y="96" width="240" height="56" rx="6" fill="${COLOR}" fill-opacity=".1"/>
      <rect x="40" y="96" width="3" height="56" fill="${COLOR}"/>
      <text x="56" y="118" font-size="13" font-weight="700" fill="${COLOR}">阅读约定</text>
      <text x="56" y="140" font-size="13" fill="var(--ink-2)">向量都写成列向量。</text>`,
  },
  {
    source: [
      [[':::', 'mark'], ['act-fn-plot', 'text'], ['{fns=relu}', 'attribute']],
      [['ReLU 和它的导数。', 'text']],
      [[':::', 'mark']],
    ],
    page: `<line x1="70" y1="138" x2="250" y2="138" stroke="var(--line)"/>
      <line x1="160" y1="92" x2="160" y2="144" stroke="var(--line)"/>
      <path d="M70 138H160L160 118H250" fill="none" stroke="var(--ink-3)" stroke-dasharray="3 3"/>
      <path d="M70 138H160L230 96" fill="none" stroke="${COLOR}" stroke-width="2.5" stroke-linejoin="round"/>
      <text x="160" y="160" text-anchor="middle" font-size="11" fill="var(--ink-2)">ReLU 和它的导数。</text>`,
  },
  {
    source: [[['**', 'mark'], ['加粗', 'text'], ['**', 'mark'], ['、', 'text'], ['*', 'mark'], ['斜体', 'text'], ['*', 'mark'], ['和 ', 'text'], ['`', 'mark'], ['code', 'text'], ['`', 'mark']]],
    page: `<text x="160" y="130" text-anchor="middle" font-size="18" fill="var(--ink)"><tspan font-weight="700">加粗</tspan>、<tspan font-style="italic">斜体</tspan>和 <tspan font-family="var(--font-mono)" font-size="16" fill="${COLOR}">code</tspan></text>`,
  },
  {
    source: [[['梯度遵循', 'text'], ['[', 'mark'], ['链式法则', 'text'], ['](', 'mark'], ['#chain-rule', 'attribute'], [')', 'mark']]],
    page: `<text x="160" y="124" text-anchor="middle" font-size="18" fill="var(--ink)">梯度遵循<tspan fill="${COLOR}" text-decoration="underline">链式法则</tspan></text>
      <text x="160" y="148" text-anchor="middle" font-size="10" font-family="var(--font-mono)" fill="var(--ink-3)">→ 被引用的文章 · 链式法则</text>`,
  },
];
const lengths = EXAMPLES.map(({ source }) => source.flat().reduce((sum, [text]) => sum + [...text].length, 0));
const durations = lengths.map((length) => length * CHARACTER + REVEAL + HOLD);
const TOTAL = durations.reduce((sum, duration) => sum + duration, 0);

export default function preview(element) {
  element.innerHTML = `<svg viewBox="0 0 320 180" aria-hidden="true" style="display:block;width:100%;height:100%;font-family:var(--font-body)">
    <rect x="16" y="12" width="288" height="64" rx="8" fill="var(--surface)" stroke="var(--line)"/>
    <text x="294" y="26" text-anchor="end" font-size="9" font-family="var(--font-mono)" fill="var(--ink-3)">Markdown</text>
    <g class="source" font-family="var(--font-mono)" font-size="11.5" style="font-variant-ligatures:none"></g>
    <rect class="caret" width="1.5" height="13" fill="${COLOR}"/>
    <rect x="16" y="84" width="288" height="84" rx="8" fill="var(--surface)" stroke="var(--line)"/>
    <text x="294" y="98" text-anchor="end" font-size="9" font-family="var(--font-mono)" fill="var(--ink-3)">页面</text>
    ${EXAMPLES.map(({ page }) => `<g class="page">${page}</g>`).join('')}
  </svg>`;
  const source = element.querySelector('.source');
  const caret = element.querySelector('.caret');
  const pages = element.querySelectorAll('.page');
  let elapsed = lengths[0] * CHARACTER + REVEAL;
  let frame = 0;
  let last;
  const draw = () => {
    let time = elapsed % TOTAL;
    let index = 0;
    while (time >= durations[index]) {
      time -= durations[index];
      index += 1;
    }
    const typing = lengths[index] * CHARACTER;
    const fade = Math.min(1, (durations[index] - time) / FADE);
    let left = Math.min(lengths[index], Math.floor(time / CHARACTER));
    const lines = EXAMPLES[index].source;
    const top = 48 - (lines.length - 1) * 9;
    source.replaceChildren();
    source.setAttribute('opacity', fade);
    let end = null;
    lines.forEach((tokens, row) => {
      const number = document.createElementNS(NAMESPACE, 'text');
      number.setAttribute('x', 34);
      number.setAttribute('y', top + row * 18);
      number.setAttribute('text-anchor', 'end');
      number.setAttribute('fill', 'var(--ink-3)');
      number.setAttribute('fill-opacity', 0.6);
      number.textContent = row + 1;
      const line = document.createElementNS(NAMESPACE, 'text');
      line.setAttribute('x', SOURCE_X);
      line.setAttribute('y', top + row * 18);
      for (const [text, kind] of tokens) {
        if (left === 0) break;
        const shown = [...text].slice(0, left).join('');
        left -= [...shown].length;
        const span = document.createElementNS(NAMESPACE, 'tspan');
        span.setAttribute('fill', INK[kind]);
        span.textContent = shown;
        line.append(span);
      }
      source.append(number, line);
      if (line.textContent !== '' || end === null) end = { line, row };
    });
    caret.setAttribute('x', SOURCE_X + end.line.getComputedTextLength() + 1);
    caret.setAttribute('y', top + end.row * 18 - 11);
    caret.setAttribute('opacity', time < typing || Math.floor(time / 500) % 2 === 0 ? fade : 0);
    pages.forEach((page, i) => page.setAttribute('opacity', i === index ? Math.min(1, Math.max(0, (time - typing) / REVEAL), fade) : 0));
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
