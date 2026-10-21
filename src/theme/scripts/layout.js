import { oncePerFrame } from './motion.js';
import { leftColumnScreen, notesColumnScreen, phoneScreen } from './screens.js';
import { declaresNaturalWidth } from './widths.js';

export const LAYOUT_EVENT = 'bk:layout';
const REACHING_BLOCKS = '.bk-block[data-resolved="wide"], .bk-block[data-resolved="page"]';
const HEADINGS = 'h2[id], h3[id]';
const WIDTH_BLOCKS = '.bk-block[data-width="auto"]';
const CODE = 'pre.shiki';
const QUOTES = /^["']|["']$/g;

let schedule = () => {};
let last = null;

export function requestLayout({ arrange = false, fresh = arrange, now = false } = {}) {
  schedule(arrange, fresh, now);
}

export function currentLayout(article) {
  if (last === null || [...last.headings.keys()].some((heading) => !heading.isConnected)) last = measure(article);
  return last;
}

export function startLayout(article, arrangements) {
  let arrangePending = true;
  let freshPending = true;
  let width = null;
  const run = () => {
    if (arrangePending) {
      const fresh = freshPending;
      arrangePending = false;
      freshPending = false;
      for (const arrangement of arrangements) arrangement(article, { fresh });
    }
    last = measure(article);
    document.dispatchEvent(new CustomEvent(LAYOUT_EVENT, { detail: last }));
  };
  const pass = oncePerFrame(run);
  schedule = (arrange, fresh = false, now = false) => {
    if (arrange) arrangePending = true;
    if (fresh) freshPending = true;
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
  for (const screen of [leftColumnScreen, notesColumnScreen, phoneScreen]) screen.addEventListener('change', () => schedule(true, true), { signal });
  document.fonts.ready.then(() => schedule(true, true));
  document.fonts.addEventListener(
    'loadingdone',
    (event) => {
      const families = measuredFamilies(article);
      const fresh = event.fontfaces.some((face) => families.has(face.family.replace(QUOTES, '')));
      document.fonts.ready.then(() => schedule(true, fresh));
    },
    { signal },
  );
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

function measuredFamilies(article) {
  const elements = [article, article.querySelector(CODE)].filter((element) => element !== null);
  return new Set(elements.flatMap((element) => getComputedStyle(element).fontFamily.split(',').map((family) => family.trim().replace(QUOTES, ''))));
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
