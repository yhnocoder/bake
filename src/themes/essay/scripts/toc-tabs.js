import { cardKeyboard, chapterCard, clamp, createElement, floorFor, hoverIntent, stateKey, tocLink } from './toc-card.js';

const SHOW_DELAY = 110;
const TAB_PITCH = 28;
const TAB_GAP = 4;
const MIN_TAB_PITCH = 18;
const TITLE_MAX = 236;
const TITLE_MIN = 48;
const TOP_SHARE = 0.16;
const TOP_MIN = 24;
const BOTTOM_ROOM = 76;

export function tabsView(context) {
  const { outline } = context;
  const root = createElement('nav', 'bk-tabs');
  root.setAttribute('aria-label', context.labels.toc);
  const intent = hoverIntent(SHOW_DELAY);
  const index = indexCard(context);
  const items = outline.chapters.map((chapter, chapterIndex) => {
    const tab = tocLink(chapter.id, 'bk-tab');
    tab.textContent = chapter.number;
    tab.setAttribute('aria-label', `${chapter.number} ${chapter.title}`);
    const title = createElement('div', 'bk-tab-title');
    const text = tocLink(chapter.id, 'bk-tab-title-text');
    text.textContent = chapter.title;
    text.tabIndex = -1;
    title.append(text);
    tab.addEventListener('pointerenter', () => hover(chapterIndex));
    tab.addEventListener('focus', () => hover(chapterIndex, tab.matches(':focus-visible')));
    tab.addEventListener('pointerleave', (event) => {
      if (!index.element.contains(event.relatedTarget)) leave();
    });
    root.append(tab, title);
    return { tab, title, text };
  });
  index.element.addEventListener('pointerenter', () => intent.stay());
  index.element.addEventListener('pointerleave', (event) => {
    if (!root.contains(event.relatedTarget)) leave();
  });
  context.host.append(root, index.element);
  cardKeyboard({ groups: items.map((item) => [item.tab]), card: index.element, shown: () => (index.shown() ? hovered : -1), leave: () => leave() });
  let shownCurrent = null;
  let hovered = -1;
  let shownState = '';

  function hover(chapterIndex, now = false) {
    items.forEach((item, itemIndex) => item.tab.classList.toggle('is-hover', itemIndex === chapterIndex));
    intent.enter(() => {
      hovered = chapterIndex;
      index.show(chapterIndex, items[chapterIndex].tab);
    }, now);
  }
  function leave() {
    intent.leave(() => {
      index.hide();
      hovered = -1;
      items.forEach((item) => item.tab.classList.remove('is-hover'));
    });
  }
  function layout(state) {
    const current = Math.max(0, state.chapter);
    items.forEach((item, itemIndex) => {
      item.tab.classList.toggle('is-current', itemIndex === current);
      item.tab.classList.toggle('is-read', itemIndex < current);
    });
    if (shownCurrent === current) return;
    if (shownCurrent === null) items.forEach((item) => (item.title.style.transition = 'none'));
    shownCurrent = current;
    measure();
    requestAnimationFrame(() => items.forEach((item) => (item.title.style.transition = '')));
  }
  function measure() {
    const room = innerHeight - TOP_MIN - BOTTOM_ROOM;
    const count = items.length;
    const pitch = Math.max(MIN_TAB_PITCH, Math.min(TAB_PITCH, room / count));
    root.style.setProperty('--tab-height', `${pitch - TAB_GAP}px`);
    const natural = items[shownCurrent].text.scrollHeight;
    const limit = Math.min(TITLE_MAX, room - count * pitch);
    const title = limit < TITLE_MIN ? 0 : Math.min(natural, limit);
    items.forEach((item, itemIndex) => {
      const on = itemIndex === shownCurrent && title > 0;
      item.title.classList.toggle('is-on', on);
      item.text.style.maxHeight = `${Math.max(limit, TITLE_MIN)}px`;
      item.title.style.height = on ? `${title + 2}px` : '0px';
    });
    root.style.top = `${Math.round(clamp(innerHeight * TOP_SHARE, TOP_MIN, innerHeight - BOTTOM_ROOM - count * pitch - title))}px`;
  }
  return {
    columns: [root],
    update(state) {
      if (!context.jumping() || shownCurrent === null) layout(state);
      const key = stateKey(state);
      if (hovered >= 0 && index.shown() && key !== shownState) index.refresh();
      shownState = key;
    },
    relayout() {
      if (shownCurrent !== null) measure();
    },
    destroy() {
      intent.stop();
      index.hide();
      root.remove();
      index.element.remove();
    },
  };
}

function indexCard(context) {
  const element = createElement('div', 'bk-index');
  const tab = createElement('a', 'bk-index-tab');
  tab.tabIndex = -1;
  const body = createElement('div', 'bk-index-body');
  element.append(tab, body);
  let shown = -1;
  let anchor = null;
  let frame = 0;
  function place() {
    const box = anchor.getBoundingClientRect();
    const floor = floorFor(box.left);
    body.style.maxHeight = `${floor - 12}px`;
    const height = Math.min(body.scrollHeight, floor - 12);
    const top = clamp(box.top - 22, 12, floor - height);
    element.style.top = `${top}px`;
    tab.style.top = `${box.top - top}px`;
    tab.style.height = `${box.height}px`;
    tab.style.width = `${box.width + 1}px`;
    body.style.left = `${box.width}px`;
  }
  function follow() {
    place();
    frame = requestAnimationFrame(follow);
  }
  function render() {
    const state = context.state();
    const chapter = context.outline.chapters[shown];
    tab.href = `#${encodeURIComponent(chapter.id)}`;
    tab.textContent = chapter.number;
    tab.classList.toggle('is-current', shown === Math.max(0, state.chapter));
    const scrollTop = body.scrollTop;
    body.replaceChildren(chapterCard(context, shown, state));
    body.scrollTop = scrollTop;
  }
  return {
    element,
    shown: () => element.classList.contains('is-on'),
    show(chapterIndex, tabElement) {
      anchor = tabElement;
      if (shown !== chapterIndex) {
        shown = chapterIndex;
        body.scrollTop = 0;
        render();
      }
      cancelAnimationFrame(frame);
      follow();
      element.classList.add('is-on');
    },
    refresh() {
      if (shown >= 0) render();
    },
    hide() {
      cancelAnimationFrame(frame);
      element.classList.remove('is-on');
      shown = -1;
    },
  };
}
