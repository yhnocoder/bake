import { labelsFor } from '../labels.js';
import { drawerView } from './drawer.js';
import { followLink } from './heading-links.jsx';
import { CONTENT_EVENT, LAYOUT_EVENT, oncePerFrame } from './motion.js';
import { SETTING_EVENT } from './settings.jsx';
import { readOutline } from './toc-card.js';
import { dotsView } from './toc-dots.js';
import { notesColumn, notesRailView } from './toc-notes.js';
import { tabsView } from './toc-tabs.js';
import { ticksView } from './toc-ticks.js';

const wideScreen = matchMedia('(min-width: 1340px)');
const mediumScreen = matchMedia('(min-width: 1000px)');
const READING_LINE = 0.25;
const READING_LINE_MAX = 200;
const DONE_SHARE = 0.85;
const VIEWS = { rail: notesRailView, tabs: tabsView, dots: dotsView, ticks: ticksView, drawer: drawerView };

export function startToc(article) {
  const nav = document.querySelector('.bk-toc');
  if (nav === null) return;
  const root = document.documentElement;
  const host = document.createElement('div');
  host.className = 'bk-toc-ui';
  document.body.append(host);
  let jumping = false;
  let state = null;
  let kind = null;
  let view = null;
  let crossing = [];

  const ctx = {
    outline: readOutline(nav),
    labels: labelsFor(root.lang),
    host,
    article,
    jumping: () => jumping,
    state: () => state,
    go(id) {
      jumping = true;
      view.jumped?.();
      followLink(`#${encodeURIComponent(id)}`).then(() =>
        requestAnimationFrame(() => {
          jumping = false;
          update();
        }),
      );
    },
  };
  let column = notesColumn(nav, ctx);
  const notesView = () => ({
    columns: [nav.querySelector('.bk-toc-column')],
    update: (next) => column.update(next),
    relayout: () => column.relayout(),
    destroy() {},
  });

  const update = oncePerFrame(() => {
    state = readingState(ctx.outline, article);
    view.update(state);
    const yielding = crossing.some(isOnScreen);
    for (const element of view.columns ?? []) element.classList.toggle('is-yielding', yielding);
  });
  const layout = oncePerFrame(() => {
    view.relayout?.();
    crossing = blocksCrossing(view.columns ?? [], article);
    update();
  });
  const mount = (again = false) => {
    const style = root.dataset.toc;
    const next = !mediumScreen.matches ? 'drawer' : style === 'notes' ? (wideScreen.matches ? 'notes' : 'rail') : style;
    if (next === kind && !again) return;
    view?.destroy();
    for (const element of document.querySelectorAll('.is-yielding')) element.classList.remove('is-yielding');
    kind = next;
    view = kind === 'notes' ? notesView() : VIEWS[kind](ctx);
    state = readingState(ctx.outline, article);
    view.update(state);
    if (kind === 'notes') column.show();
    layout();
  };

  const onClick = (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href^="#"]');
    if (link === null) return;
    event.preventDefault();
    ctx.go(decodeURIComponent(link.getAttribute('href').slice(1)));
  };
  nav.addEventListener('click', onClick);
  host.addEventListener('click', onClick);
  const settle = () => requestAnimationFrame(() => requestAnimationFrame(() => nav.classList.add('is-ready')));
  const reread = () => {
    nav.classList.remove('is-ready');
    column.destroy();
    ctx.outline = readOutline(nav);
    column = notesColumn(nav, ctx);
    mount(true);
    settle();
  };
  mount();
  settle();
  addEventListener('scroll', update, { passive: true });
  addEventListener('resize', layout);
  document.addEventListener(LAYOUT_EVENT, layout);
  document.fonts.addEventListener('loadingdone', layout);
  document.addEventListener(CONTENT_EVENT, reread);
  new ResizeObserver(layout).observe(article);
  wideScreen.addEventListener('change', () => mount());
  mediumScreen.addEventListener('change', () => mount());
  document.addEventListener(SETTING_EVENT, (event) => {
    if (event.detail.name === 'toc') mount();
  });
}

function readingState(outline, article) {
  const { entries, chapters } = outline;
  const height = innerHeight;
  const line = Math.min(height * READING_LINE, READING_LINE_MAX);
  const tops = entries.map((entry) => (entry.heading === null ? Infinity : entry.heading.getBoundingClientRect().top));
  let entry = -1;
  for (const [index, top] of tops.entries()) {
    if (top <= line) entry = index;
    else break;
  }
  const atEnd = scrollY > 0 && scrollY + height >= document.documentElement.scrollHeight - 4;
  if (atEnd) entry = entries.length - 1;
  const articleBottom = article.getBoundingClientRect().bottom;
  let entryDone = atEnd;
  if (entry >= 0 && !atEnd) {
    const top = tops[entry];
    const end = entry + 1 < tops.length ? tops[entry + 1] : articleBottom;
    entryDone = height / 2 - top >= DONE_SHARE * (end - top);
  }
  const chapter = entry >= 0 ? entries[entry].chapter : -1;
  let progress = 0;
  if (chapter >= 0) {
    const top = tops[chapters[chapter].index];
    const next = chapter + 1 < chapters.length ? tops[chapters[chapter + 1].index] : articleBottom - height * 0.4;
    progress = atEnd ? 1 : Math.min(1, Math.max(0, (line - top) / Math.max(1, next - top)));
  }
  return {
    entry,
    chapter,
    section: entry >= 0 ? entries[entry].section : -1,
    progress,
    read: entries.map((_, index) => index < entry || (index === entry && entryDone)),
  };
}

function blocksCrossing(columns, article) {
  const spans = columns.map((column) => column.getBoundingClientRect()).filter((box) => box.width > 0);
  if (spans.length === 0) return [];
  return [...article.querySelectorAll('.bk-block')].filter((block) => {
    const box = block.getBoundingClientRect();
    return box.height > 0 && spans.some((span) => box.left < span.right && box.right > span.left);
  });
}

function isOnScreen(block) {
  const box = block.getBoundingClientRect();
  return box.bottom > 0 && box.top < innerHeight;
}
