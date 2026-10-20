import { CONTENT_EVENT, LAYOUT_EVENT, SETTING_EVENT, currentLayout, followLink, labelsFor, leftColumnScreen, notesColumnScreen, oncePerFrame } from 'bake/theme/client';
import { showButtonsDuring } from './buttons.js';
import { drawerView } from './drawer.js';
import { readOutline } from './toc-card.js';
import { dotsView } from './toc-dots.js';
import { notesColumn, notesRailView } from './toc-notes.js';
import { tabsView } from './toc-tabs.js';
import { ticksView } from './toc-ticks.js';

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
  document.body.insertBefore(host, document.querySelector('.bk-shell'));
  let jumping = false;
  let state = null;
  let kind = null;
  let mountedStyle = null;
  let view = null;
  let crossing = [];

  const context = {
    outline: readOutline(nav),
    labels: labelsFor(root.lang),
    host,
    article,
    jumping: () => jumping,
    state: () => state,
    go(hash) {
      jumping = true;
      view.jumped?.();
      const jump = followLink(hash);
      showButtonsDuring(jump);
      jump.then(() =>
        requestAnimationFrame(() => {
          jumping = false;
          update();
        }),
      );
    },
  };
  let column = notesColumn(nav, context);
  const notesView = () => ({
    columns: [nav.querySelector('.bk-toc-column')],
    update: (next) => column.update(next),
    relayout: () => column.relayout(),
    destroy() {},
  });

  const update = oncePerFrame(() => {
    state = readingState(context.outline, currentLayout(article));
    view.update(state);
    const yielding = crossing.some(isOnScreen);
    for (const element of view.columns ?? []) {
      element.classList.toggle('is-yielding', yielding);
      element.inert = yielding;
    }
  });
  const layout = oncePerFrame(() => {
    view.relayout?.();
    crossing = blocksCrossing(view.columns ?? [], currentLayout(article));
    update();
  });
  const mount = (again = false) => {
    const style = root.dataset.toc;
    const next = !notesColumnScreen.matches ? 'drawer' : style === 'notes' ? (leftColumnScreen.matches ? 'notes' : 'rail') : style;
    if (next === kind && style === mountedStyle && !again) return;
    view?.destroy();
    for (const element of document.querySelectorAll('.is-yielding')) {
      element.classList.remove('is-yielding');
      element.inert = false;
    }
    kind = next;
    mountedStyle = style;
    view = kind === 'notes' ? notesView() : VIEWS[kind](context);
    state = readingState(context.outline, currentLayout(article));
    view.update(state);
    if (kind === 'notes') column.show();
    layout();
  };

  const onClick = (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href^="#"]');
    if (link === null) return;
    event.preventDefault();
    context.go(link.getAttribute('href'));
  };
  nav.addEventListener('click', onClick);
  host.addEventListener('click', onClick);
  const settle = () => requestAnimationFrame(() => requestAnimationFrame(() => nav.classList.add('is-ready')));
  const reread = () => {
    nav.classList.remove('is-ready');
    const saved = view.saved?.() ?? null;
    column.destroy();
    context.outline = readOutline(nav);
    column = notesColumn(nav, context);
    mount(true);
    if (saved !== null) view.restore(saved);
    settle();
  };
  mount();
  settle();
  addEventListener('scroll', update, { passive: true });
  document.addEventListener(LAYOUT_EVENT, layout);
  document.addEventListener(CONTENT_EVENT, reread);
  leftColumnScreen.addEventListener('change', () => mount());
  notesColumnScreen.addEventListener('change', () => mount());
  document.addEventListener(SETTING_EVENT, (event) => {
    if (event.detail.name === 'toc') mount();
  });
}

function readingState(outline, measured) {
  const { entries, chapters } = outline;
  const height = innerHeight;
  const line = Math.min(height * READING_LINE, READING_LINE_MAX);
  const tops = entries.map((entry) => (measured.headings.get(entry.heading) ?? Infinity) - scrollY);
  let entry = -1;
  for (const [index, top] of tops.entries()) {
    if (top <= line) entry = index;
    else break;
  }
  const atEnd = scrollY > 0 && scrollY + height >= document.documentElement.scrollHeight - 4;
  if (atEnd) entry = entries.length - 1;
  const articleBottom = measured.article.bottom - scrollY;
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

function blocksCrossing(columns, measured) {
  const spans = columns.map((column) => column.getBoundingClientRect()).filter((box) => box.width > 0).map((box) => ({ left: box.left + scrollX, right: box.right + scrollX }));
  if (spans.length === 0) return [];
  return measured.blocks.filter((block) => block.height > 0 && spans.some((span) => block.left < span.right && block.right > span.left));
}

function isOnScreen(block) {
  return block.bottom - scrollY > 0 && block.top - scrollY < innerHeight;
}
