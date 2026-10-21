import { currentLayout, markCurrent } from 'bake/theme/client';
import { ENTRY_GAP, clamp, createElement, tocLink, withoutTransition } from './toc-card.js';

export const DOTS_CARD = { variant: 'dots', showDelay: 90 };
const DOT_PITCH = 16;
const TITLE_MAX = 168;
const CAPSULE_EDGES = 37;
const DOT_SIZE = 6;
const TOP_SHARE = 0.2;
const TOP_MIN = 24;
const COLUMN_WIDTH = 24;
const TEXT_DISTANCE = 76;
const CARD_GAP = 14;
const CARD_RISE = 34;
const FOLDED = -1;

export function dotsView({ outline, labels, host, article, reserve, jumping }) {
  const root = createElement('nav', 'bk-toc-dots');
  root.setAttribute('aria-label', labels.toc);
  const items = outline.chapters.map((chapter) => {
    const item = tocLink(chapter.id, 'bk-toc-dot-item');
    item.dataset.index = chapter.index;
    item.setAttribute('aria-label', `${chapter.number} ${chapter.title}`);
    const dot = createElement('span', 'bk-toc-dot');
    const faces = ['is-base', 'is-fill'].map((kind) => {
      const face = createElement('span', `bk-toc-dot-face ${kind}`);
      face.setAttribute('aria-hidden', 'true');
      face.append(createElement('span', 'bk-toc-dot-number', chapter.number), createElement('span', 'bk-toc-dot-title', chapter.title));
      return face;
    });
    dot.append(...faces);
    item.append(dot);
    root.append(item);
    return { item, dot, title: faces[0].lastChild, fill: faces[1], progress: '0' };
  });
  host.append(root);
  let current = null;
  let goal = null;
  let left = 0;
  let top = 0;
  let offsets = [];
  let dotInset = 0;

  function measure() {
    const room = innerHeight - TOP_MIN - reserve - ENTRY_GAP;
    const count = items.length;
    const pitch = Math.min(DOT_PITCH, Math.max(8, (room - CAPSULE_EDGES) / count));
    root.style.setProperty('--dot-pitch', `${pitch}px`);
    const entry = items[current];
    const limit = Math.max(0, Math.min(TITLE_MAX, room - count * pitch - CAPSULE_EDGES));
    const title = entry === undefined ? 0 : Math.min(entry.title.scrollHeight, limit);
    root.style.setProperty('--capsule-title', `${limit}px`);
    entry?.dot.style.setProperty('--capsule-height', `${title + CAPSULE_EDGES}px`);
    const grown = entry === undefined ? 0 : title + CAPSULE_EDGES - DOT_SIZE;
    offsets = items.map((item, index) => index * pitch + (index > current ? grown : 0));
    items.forEach((item, index) => (item.item.style.translate = `0 ${offsets[index]}px`));
    // why: the column keeps its place while a jump folds the capsule, so that only the dots change
    if (entry !== undefined) top = Math.round(clamp(innerHeight * TOP_SHARE, TOP_MIN, innerHeight - reserve - ENTRY_GAP - count * pitch - title - CAPSULE_EDGES));
    root.style.top = `${top}px`;
    root.style.height = `${count * pitch + grown}px`;
    dotInset = (pitch - DOT_SIZE) / 2;
    left = Math.max(16, currentLayout(article).article.left - scrollX - TEXT_DISTANCE);
    root.style.left = `${left}px`;
  }

  return {
    columns: [root],
    chapters: items.map((entry) => [entry.item]),
    anchor: (chapter) => ({ left: left + COLUMN_WIDTH + CARD_GAP, top: top + offsets[chapter] + dotInset + DOT_SIZE / 2 - CARD_RISE }),
    jumped(hash) {
      const target = outline.entries.find((entry) => entry.id === decodeURIComponent(hash.slice(1)));
      if (current === null || target?.chapter === current) return;
      current = FOLDED;
      goal = target?.chapter;
      items.forEach((entry) => markCurrent(entry.item, false));
      measure();
    },
    update(state) {
      const next = Math.max(0, state.chapter);
      if (jumping() && current === FOLDED && next !== goal) {
        items.forEach((entry, index) => {
          entry.item.classList.toggle('is-read', index < next);
          entry.item.classList.toggle('is-passing', index === next);
        });
        return;
      }
      items.forEach((entry) => entry.item.classList.remove('is-passing'));
      items.forEach((entry, index) => {
        entry.item.classList.toggle('is-read', index < next);
        markCurrent(entry.item, index === next);
        const progress = index === next && state.chapter >= 0 ? state.progress.toFixed(4) : '0';
        if (progress === entry.progress) return;
        entry.progress = progress;
        entry.fill.style.setProperty('--progress', progress);
      });
      if (next === current) return;
      const first = current === null;
      current = next;
      if (first) withoutTransition(items.flatMap((entry) => [entry.item, entry.dot]), measure);
      else measure();
    },
    relayout() {
      if (current !== null) withoutTransition(items.flatMap((entry) => [entry.item, entry.dot]), measure);
    },
    destroy() {
      root.remove();
    },
  };
}
