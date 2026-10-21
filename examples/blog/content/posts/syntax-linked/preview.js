const MATH_FONT = "'STIX Two Math', 'Cambria Math', 'Times New Roman', serif";
const STYLE = `
.lp { position: absolute; inset: 0; padding: 5cqw 8cqw; font-size: 4cqw; color: var(--ink); font-family: var(--font-body); }
.lp p { margin: 0; line-height: 1.8; }
.lp a { color: var(--accent); text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--accent) 45%, transparent); text-underline-offset: .22em; text-decoration-thickness: .06em; }
.lp-pointer { position: absolute; width: 4.2cqw; left: 0; top: 0; filter: drop-shadow(0 .3cqw .5cqw rgba(0, 0, 0, .25)); }
.lp-card { position: absolute; width: 64cqw; padding: 2.6cqw 3.6cqw 2.2cqw; border-radius: 2.6cqw; background: var(--surface); box-shadow: 0 0 0 .5px var(--line-2), 0 3cqw 6cqw -2cqw rgba(0, 0, 0, .28); opacity: 0; translate: 0 1.5cqw; }
.lp-card.lp-open { opacity: 1; translate: 0 0; }
.lp-playing .lp-pointer { transition: left .6s cubic-bezier(.2, .7, .2, 1), top .6s cubic-bezier(.2, .7, .2, 1); }
.lp-playing .lp-card { transition: opacity .25s, translate .35s cubic-bezier(.2, .7, .2, 1); }
.lp-where { font-family: var(--font-ui); font-size: 2.6cqw; color: var(--ink-3); }
.lp-title { font-weight: 700; font-size: 3.8cqw; margin: .4cqw 0 .6cqw; }
.lp-text { font-size: 3.2cqw; line-height: 1.7; }
.lp-formula { text-align: center; font-size: 3.6cqw; margin-top: .6cqw; }
.lp-math { font-family: ${MATH_FONT}; font-style: italic; }
.lp-fraction { display: inline-flex; flex-direction: column; align-items: center; vertical-align: middle; line-height: 1.15; margin: 0 .1em; }
.lp-fraction > :first-child { border-bottom: .06em solid currentColor; padding: 0 .1em; }
.lp-go { margin-top: 1.4cqw; padding-top: 1.2cqw; border-top: .5px solid var(--line); font-size: 2.5cqw; color: var(--ink-3); font-family: var(--font-ui); }
`;
const fraction = (top, bottom) => `<span class="lp-fraction"><span>${top}</span><span>${bottom}</span></span>`;
const variable = (name) => `<span class="lp-math">${name}</span>`;

// The pointer rests on the two links of the syntax article that lead here, and each opens the preview card of its target.
export default function preview(element) {
  element.style.containerType = 'size';
  element.innerHTML = `<style>${STYLE}</style><div class="lp">
    <p>SwiGLU 的反向传播同样遵循<a>链式法则</a>，门控的梯度按<a>这一段</a>的方法计算。</p>
    <div class="lp-card">
      <div class="lp-where">写法示范：被引用的文章 · 1</div>
      <div class="lp-title">链式法则</div>
      <div class="lp-text">设 ${variable('y')} = ${variable('f')}(${variable('u')})，${variable('u')} = ${variable('g')}(${variable('x')})，则</div>
      <div class="lp-formula lp-math">${fraction('∂y', '∂x')} = (${fraction('∂u', '∂x')})<sup style="font-size:.6em">T</sup> ${fraction('∂y', '∂u')}</div>
      <div class="lp-go">点击跳转到原文 →</div>
    </div>
    <div class="lp-card">
      <div class="lp-where">写法示范：被引用的文章 · 1</div>
      <div class="lp-text" style="margin-top:.8cqw">每一层的梯度都由上一层传回的梯度乘以本层的局部导数得到。局部导数只依赖本层的输入和输出。</div>
      <div class="lp-go">点击跳转到原文 →</div>
    </div>
    <svg class="lp-pointer" viewBox="0 0 16 22" aria-hidden="true"><path d="M1 1L1 17L5.2 13.2L8 20L10.6 18.9L7.9 12.4L13.5 12.4Z" fill="#fff" stroke="#111" stroke-width="1.1" stroke-linejoin="round"/></svg>
  </div>`;
  const root = element.querySelector('.lp');
  const links = element.querySelectorAll('a');
  const cards = element.querySelectorAll('.lp-card');
  const pointer = element.querySelector('.lp-pointer');
  let current = 0;
  const place = (i) => {
    current = i;
    const box = root.getBoundingClientRect();
    const link = links[i].getBoundingClientRect();
    const unit = box.width / 100;
    const card = cards[i];
    pointer.style.left = `${link.left - box.left + link.width * 0.55}px`;
    pointer.style.top = `${link.top - box.top + link.height * 0.35}px`;
    card.style.left = `${Math.min(Math.max(link.left - box.left - 6 * unit, 4 * unit), box.width - card.offsetWidth - 4 * unit)}px`;
    card.style.top = `${link.bottom - box.top + 1.2 * unit}px`;
  };
  const open = (i) => cards.forEach((card, j) => card.classList.toggle('lp-open', j === i));
  place(0);
  open(0);
  // why: the links move when the card changes width or a font finishes loading, and the pointer and the card follow them
  new ResizeObserver(() => place(current)).observe(element);
  document.fonts.ready.then(() => place(current));
  const steps = [
    [() => open(-1), 250],
    [() => place(1), 650],
    [() => open(1), 2000],
    [() => open(-1), 250],
    [() => place(0), 650],
    [() => open(0), 2000],
  ];
  let step = 0;
  let timer = 0;
  const run = () => {
    const [action, wait] = steps[step];
    action();
    step = (step + 1) % steps.length;
    timer = setTimeout(run, wait);
  };
  return {
    start() {
      root.classList.add('lp-playing');
      clearTimeout(timer);
      timer = setTimeout(run, 1200);
    },
    stop() {
      clearTimeout(timer);
    },
  };
}
