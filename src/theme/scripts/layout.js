import { CONTENT_EVENT, oncePerFrame } from './motion.js';

export const LAYOUT_EVENT = 'bk:layout';
const REACHING_BLOCKS = '.bk-block[data-resolved="wide"], .bk-block[data-resolved="page"]';
const HEADINGS = 'h2[id], h3[id]';
const WIDTH_BLOCKS = '.bk-block[data-width="auto"]';

let schedule = () => {};
let last = null;

export function requestLayout({ arrange = false } = {}) {
  schedule(arrange);
}

export function currentLayout(article) {
  if (last === null || [...last.headings.keys()].some((heading) => !heading.isConnected)) last = measure(article);
  return last;
}

export function startLayout(article, arrangements) {
  let arrangePending = true;
  let width = null;
  const pass = oncePerFrame(() => {
    if (arrangePending) {
      arrangePending = false;
      for (const arrangement of arrangements) arrangement(article);
    }
    last = measure(article);
    document.dispatchEvent(new CustomEvent(LAYOUT_EVENT, { detail: last }));
  });
  schedule = (arrange) => {
    if (arrange) arrangePending = true;
    pass();
  };
  new ResizeObserver(([entry]) => {
    const changed = entry.contentRect.width !== width;
    width = entry.contentRect.width;
    schedule(changed);
  }).observe(article);
  addEventListener('resize', () => schedule(true));
  document.fonts.ready.then(() => schedule(true));
  document.fonts.addEventListener('loadingdone', () => schedule(true));
  document.addEventListener(CONTENT_EVENT, () => schedule(true));
  article.addEventListener('toggle', (event) => schedule(event.target.closest(WIDTH_BLOCKS) !== null), true);
  pass();
}

function measure(article) {
  const top = scrollY;
  const left = scrollX;
  const box = (element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top + top, bottom: rect.bottom + top, left: rect.left + left, right: rect.right + left, height: rect.height };
  };
  return {
    article: box(article),
    blocks: [...article.querySelectorAll(REACHING_BLOCKS)].map((element) => ({ element, ...box(element) })),
    headings: new Map([...article.querySelectorAll(HEADINGS)].map((element) => [element, box(element).top])),
  };
}
