import { markCurrent } from 'bake/theme/client';
import { ENTRY_GAP, clamp, createElement, tocLink, withoutTransition } from './toc-card.js';

export const TABS_CARD = { variant: 'tabs', showDelay: 110 };
const TAB_PITCH = 28;
const TAB_GAP = 4;
const MIN_TAB_PITCH = 18;
const TITLE_MAX = 236;
const TITLE_MIN = 48;
const TOP_SHARE = 0.16;
const TOP_MIN = 24;
const CARD_RISE = 22;

export function tabsView({ outline, labels, host, reserve, jumping }) {
  const root = createElement('nav', 'bk-toc-tabs');
  root.setAttribute('aria-label', labels.toc);
  const items = outline.chapters.map((chapter) => {
    const tab = tocLink(chapter.id, 'bk-toc-tab');
    tab.append(createElement('span', 'bk-toc-tab-number', chapter.number));
    tab.dataset.index = chapter.index;
    tab.setAttribute('aria-label', `${chapter.number} ${chapter.title}`);
    const title = createElement('div', 'bk-toc-tab-title');
    const text = tocLink(chapter.id, 'bk-toc-tab-title-text');
    text.textContent = chapter.title;
    text.tabIndex = -1;
    title.append(text);
    root.append(tab, title);
    return { tab, title, text };
  });
  host.append(root);
  let current = null;
  let geometry = null;

  function measure() {
    const room = innerHeight - TOP_MIN - reserve - ENTRY_GAP;
    const count = items.length;
    const pitch = Math.max(MIN_TAB_PITCH, Math.min(TAB_PITCH, room / count));
    root.style.setProperty('--tab-height', `${pitch - TAB_GAP}px`);
    const limit = Math.min(TITLE_MAX, room - count * pitch);
    const title = limit < TITLE_MIN ? 0 : Math.min(items[current].text.scrollHeight, limit);
    const opened = title > 0 ? title + 2 : 0;
    items.forEach((item, index) => {
      item.text.style.maxHeight = `${Math.max(limit, TITLE_MIN)}px`;
      item.tab.style.translate = `0 ${index * pitch + (index > current ? opened : 0)}px`;
      const on = index === current && opened > 0;
      item.title.classList.toggle('is-on', on);
      if (!on) return;
      item.title.style.height = `${opened}px`;
      item.title.style.translate = `0 ${(index + 1) * pitch}px`;
    });
    const top = Math.round(clamp(innerHeight * TOP_SHARE, TOP_MIN, innerHeight - reserve - ENTRY_GAP - count * pitch - title));
    root.style.top = `${top}px`;
    root.style.height = `${count * pitch + opened}px`;
    geometry = { top, pitch, opened };
  }

  return {
    columns: [root],
    chapters: items.map((item) => [item.tab]),
    anchor(chapter) {
      const tabTop = geometry.top + chapter * geometry.pitch + (chapter > current ? geometry.opened : 0);
      return { left: 0, top: tabTop - CARD_RISE, tabTop, tabHeight: geometry.pitch - TAB_GAP };
    },
    update(state) {
      if (jumping() && current !== null) return;
      const next = Math.max(0, state.chapter);
      if (next === current) return;
      items.forEach((item, index) => {
        markCurrent(item.tab, index === next);
        item.tab.classList.toggle('is-read', index < next);
      });
      const first = current === null;
      current = next;
      if (first) withoutTransition(items.flatMap((item) => [item.tab, item.title]), measure);
      else measure();
    },
    relayout() {
      if (current !== null) withoutTransition(items.flatMap((item) => [item.tab, item.title]), measure);
    },
    destroy() {
      root.remove();
    },
  };
}
