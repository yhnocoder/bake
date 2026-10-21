import { LAYOUT_EVENT, SETTING_EVENT, currentLayout, followLink, leftColumnScreen, notesColumnScreen, oncePerFrame, requestLayout } from 'bake/theme/client';
import { essayLabels } from '../essay-labels.js';
import { showButtonsDuring } from './buttons.js';
import { drawerView } from './drawer.js';
import { bottomReserve, createCardHost, readOutline } from './toc-card.js';
import { DOTS_CARD, dotsView } from './toc-dots.js';
import { RAIL_CARD, notesView, railView } from './toc-notes.js';
import { TABS_CARD, tabsView } from './toc-tabs.js';
import { TICKS_CARD, ticksView } from './toc-ticks.js';

const READING_LINE = 0.25;
const READING_LINE_MAX = 200;
const DONE_SHARE = 0.85;
const DRAWER = { view: drawerView };
const TABS = { view: tabsView, card: TABS_CARD };
const DOTS = { view: dotsView, card: DOTS_CARD };
const TICKS = { view: ticksView, card: TICKS_CARD };
const STYLES = {
  notes: { left: { view: notesView }, notes: { view: railView, card: RAIL_CARD }, phone: DRAWER },
  tabs: { left: TABS, notes: TABS, phone: DRAWER },
  dots: { left: DOTS, notes: DOTS, phone: DRAWER },
  ticks: { left: TICKS, notes: TICKS, phone: DRAWER },
};

// why: bake dev starts the table of contents again after each partial update, and the drawer stays open where the reader left it
let keptDrawer = null;

export function startToc(article) {
  const nav = document.querySelector('.bk-toc');
  if (nav === null) return () => {};
  const root = document.documentElement;
  const host = document.createElement('div');
  host.className = 'bk-toc-ui';
  document.body.insertBefore(host, document.querySelector('.bk-shell'));
  const outline = readOutline(nav);
  const labels = essayLabels(root.lang);
  let jumping = false;
  let state = null;
  let mounted = null;
  let view = null;
  let card = null;
  let crossing = [];
  let yielded = false;

  const go = (hash) => {
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
  };
  const draw = () => {
    state = readingState(outline, currentLayout(article));
    view.update(state);
    card?.update(state);
    const yielding = crossing.some(isOnScreen);
    if (yielding === yielded) return;
    yielded = yielding;
    for (const element of view.columns ?? []) {
      element.classList.toggle('is-yielding', yielding);
      element.inert = yielding;
    }
  };
  const update = oncePerFrame(draw);
  const layout = () => {
    view.relayout?.();
    card?.relayout();
    crossing = blocksCrossing(view.columns ?? [], currentLayout(article));
    draw();
  };
  const unmount = () => {
    view?.destroy();
    card?.destroy();
    for (const element of document.querySelectorAll('.is-yielding')) {
      element.classList.remove('is-yielding');
      element.inert = false;
    }
    yielded = false;
  };
  const mount = () => {
    const style = root.dataset.toc in STYLES ? root.dataset.toc : 'notes';
    const screen = leftColumnScreen.matches ? 'left' : notesColumnScreen.matches ? 'notes' : 'phone';
    const spec = STYLES[style][screen];
    const key = spec === DRAWER ? `${style} drawer` : spec;
    if (key === mounted) return;
    unmount();
    mounted = key;
    state = readingState(outline, currentLayout(article));
    card = spec.card === undefined ? null : createCardHost(spec.card);
    const reserve = bottomReserve(host);
    view = spec.view({ outline, labels, style, host, card, go, nav, article, reserve, jumping: () => jumping, state: () => state });
    card?.connect(view, { outline, labels, host, reserve, state: () => state });
    layout();
  };

  const onClick = (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href^="#"]');
    if (link === null) return;
    event.preventDefault();
    go(link.getAttribute('href'));
  };
  mount();
  if (keptDrawer !== null) view.restore(keptDrawer);
  keptDrawer = null;
  requestAnimationFrame(() => requestAnimationFrame(() => nav.classList.add('is-ready')));
  const controller = new AbortController();
  const { signal } = controller;
  nav.addEventListener('click', onClick, { signal });
  host.addEventListener('click', onClick);
  addEventListener('scroll', update, { passive: true, signal });
  document.addEventListener(LAYOUT_EVENT, layout, { signal });
  leftColumnScreen.addEventListener('change', mount, { signal });
  notesColumnScreen.addEventListener('change', mount, { signal });
  document.addEventListener(
    SETTING_EVENT,
    (event) => {
      if (event.detail.name !== 'toc') return;
      mount();
      requestLayout();
    },
    { signal },
  );
  return () => {
    controller.abort();
    keptDrawer = view.saved?.() ?? null;
    unmount();
    host.remove();
    nav.classList.remove('is-ready');
  };
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
