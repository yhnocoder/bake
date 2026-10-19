import { labelsFor } from '../labels.js';
import { startDrawer } from './drawer.jsx';
import { LAYOUT_EVENT, oncePerFrame, reducedMotion } from './motion.js';

const READING_LINE = 0.3;
const READING_LINE_MAX = 240;
const FOLLOW_POSITION = 0.35;
const FOLLOW_DELAY = 340;

export function startToc(article) {
  const nav = document.querySelector('.bk-toc');
  if (nav === null) return;
  const list = nav.querySelector('.bk-toc-list');
  const sticky = nav.querySelector('.bk-toc-sticky');
  const copy = list.cloneNode(true);
  startDrawer(copy, labelsFor(document.documentElement.lang));
  const views = [list, copy].map(readView);
  const headings = views[0].entries.map((entry) => document.getElementById(entry.dataset.target));
  let current = null;
  let crossing = [];

  const update = oncePerFrame(() => {
    sticky.style.setProperty('--toc-top', `${Math.max(0, Math.round(sticky.getBoundingClientRect().top))}px`);
    nav.classList.toggle('is-yielding', crossing.some(isOnScreen));
    const state = readingState(headings, article);
    for (const view of views) showState(view, state);
    if (state.index !== current) {
      const first = current === null;
      current = state.index;
      setTimeout(() => views.forEach((view) => follow(view, !first)), first ? 0 : FOLLOW_DELAY);
    }
  });
  const layout = oncePerFrame(() => {
    placeNav(nav, article);
    crossing = blocksCrossing(nav, article);
    update();
  });
  layout();
  requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add('bk-toc-ready')));
  addEventListener('scroll', update, { passive: true });
  addEventListener('resize', layout);
  document.addEventListener(LAYOUT_EVENT, layout);
  new ResizeObserver(layout).observe(article);
}

function blocksCrossing(nav, article) {
  const column = nav.getBoundingClientRect();
  if (column.width === 0) return [];
  return [...article.querySelectorAll('.bk-block')].filter((block) => {
    const box = block.getBoundingClientRect();
    return box.height > 0 && box.left < column.right && box.right > column.left;
  });
}

function isOnScreen(block) {
  const box = block.getBoundingClientRect();
  return box.bottom > 0 && box.top < innerHeight;
}

function readView(list) {
  const chapters = [...list.querySelectorAll('.bk-toc-chapter')];
  const entries = [...list.querySelectorAll('.bk-toc-entry')];
  return {
    list,
    entries,
    chapters,
    chapterOf: entries.map((entry) => chapters.indexOf(entry.closest('.bk-toc-chapter'))),
    progress: entries.map((entry) => entry.querySelector('.bk-toc-progress')),
  };
}

function placeNav(nav, article) {
  const parent = nav.offsetParent ?? document.documentElement;
  const top = article.getBoundingClientRect().top - parent.getBoundingClientRect().top - parent.clientTop;
  nav.style.top = `${Math.round(top)}px`;
  nav.style.height = `${article.offsetHeight}px`;
}

function readingState(headings, article) {
  const line = Math.min(innerHeight * READING_LINE, READING_LINE_MAX);
  let index = -1;
  for (const [position, heading] of headings.entries()) {
    if (heading === null) continue;
    if (heading.getBoundingClientRect().top <= line) index = position;
    else break;
  }
  if (index === -1) return { index, progress: 0 };
  const top = headings[index].getBoundingClientRect().top;
  const next = headings.slice(index + 1).find((heading) => heading !== null);
  const end = next === undefined ? article.getBoundingClientRect().bottom : next.getBoundingClientRect().top;
  return { index, progress: Math.min(1, Math.max(0, (line - top) / Math.max(1, end - top))) };
}

function showState(view, { index, progress }) {
  const chapter = index === -1 ? -1 : view.chapterOf[index];
  view.chapters.forEach((element, position) => {
    element.dataset.state = relation(position, chapter);
  });
  view.entries.forEach((entry, position) => {
    entry.dataset.state = relation(position, index);
    view.progress[position].style.transform = `scaleY(${position === index ? progress : 0})`;
  });
}

function relation(position, current) {
  if (position < current) return 'read';
  return position === current ? 'current' : 'ahead';
}

function follow(view, smooth) {
  const scroller = view.list.closest('.bk-toc-scroll');
  if (scroller === null || scroller.clientHeight === 0 || scroller.matches(':hover')) return;
  const entry = view.list.querySelector('.bk-toc-entry[data-state="current"]');
  if (entry === null) return;
  const offset = entry.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  const target = Math.max(0, offset - scroller.clientHeight * FOLLOW_POSITION);
  if (Math.abs(scroller.scrollTop - target) < 1) return;
  scroller.scrollTo({ top: target, behavior: smooth && !reducedMotion.matches ? 'smooth' : 'instant' });
}
