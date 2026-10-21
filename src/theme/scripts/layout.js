import { oncePerFrame } from './motion.js';
import { leftColumnScreen, notesColumnScreen, phoneScreen } from './screens.js';
import { declaresNaturalWidth } from './widths.js';

export const LAYOUT_EVENT = 'bk:layout';
const BLOCKS = '.bk-block[data-width]';
const HEADINGS = 'h2[id], h3[id]';
const WIDTH_BLOCKS = '.bk-block[data-width="auto"]';

let schedule = () => {};
let last = null;

export function requestLayout({ arrange = false, now = false } = {}) {
  schedule(arrange, now);
}

export function currentLayout(article) {
  if (last === null || [...last.headings.keys()].some((heading) => !heading.isConnected)) last = measure(article);
  return last;
}

export function startLayout(article, arrangements) {
  let arrangePending = true;
  let width = null;
  const run = () => {
    if (arrangePending) {
      arrangePending = false;
      for (const arrangement of arrangements) arrangement(article);
    }
    last = measure(article);
    document.dispatchEvent(new CustomEvent(LAYOUT_EVENT, { detail: last }));
  };
  const pass = oncePerFrame(run);
  schedule = (arrange, now = false) => {
    if (arrange) arrangePending = true;
    if (now) run();
    else pass();
  };
  const resizes = new ResizeObserver(([entry]) => {
    const changed = entry.contentRect.width !== width;
    width = entry.contentRect.width;
    schedule(changed);
  });
  resizes.observe(article);
  const controller = new AbortController();
  const { signal } = controller;
  addEventListener('resize', () => schedule(true), { signal });
  for (const screen of [leftColumnScreen, notesColumnScreen, phoneScreen]) screen.addEventListener('change', () => schedule(true), { signal });
  document.fonts.ready.then(() => schedule(true));
  document.fonts.addEventListener('loadingdone', () => document.fonts.ready.then(() => schedule(true)), { signal });
  article.addEventListener(
    'toggle',
    (event) => {
      const block = event.target.closest(WIDTH_BLOCKS);
      schedule(block !== null && !declaresNaturalWidth(block));
    },
    { capture: true, signal },
  );
  pass();
  return () => {
    resizes.disconnect();
    controller.abort();
    schedule = () => {};
    last = null;
  };
}

function measure(article) {
  const top = scrollY;
  const left = scrollX;
  const box = (element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top + top, bottom: rect.bottom + top, left: rect.left + left, right: rect.right + left, height: rect.height };
  };
  const column = box(article);
  return {
    article: column,
    blocks: [...article.querySelectorAll(BLOCKS)].map((element) => ({ element, ...box(element) })).filter((block) => block.left < column.left - 0.5 || block.right > column.right + 0.5),
    headings: new Map([...article.querySelectorAll(HEADINGS)].map((element) => [element, box(element).top])),
  };
}
