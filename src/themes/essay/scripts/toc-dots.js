import { cardKeyboard, chapterCard, clamp, el, floorFor, hoverIntent, stateKey, tocLink } from './toc-card.js';

const SHOW_DELAY = 90;
const DOT_PITCH = 16;
const TITLE_MAX = 168;
const CAPSULE_EDGES = 37;
const TOP_SHARE = 0.2;
const TOP_MIN = 24;
const BOTTOM_ROOM = 76;

export function dotsView(ctx) {
  const { outline } = ctx;
  const root = el('nav', 'bk-dots');
  root.setAttribute('aria-label', ctx.labels.toc);
  const card = el('div', 'bk-popover');
  const intent = hoverIntent(SHOW_DELAY);
  const items = outline.chapters.map((chapter, chapterIndex) => {
    const item = tocLink(chapter.id, 'bk-dot-item');
    item.setAttribute('aria-label', `${chapter.number} ${chapter.title}`);
    const dot = el('span', 'bk-dot');
    const faces = ['is-base', 'is-fill'].map((kind) => {
      const face = el('span', `bk-dot-face ${kind}`);
      face.setAttribute('aria-hidden', 'true');
      face.append(el('span', 'bk-dot-number', chapter.number), el('span', 'bk-dot-title', chapter.title));
      return face;
    });
    dot.append(...faces);
    item.append(dot);
    item.addEventListener('pointerenter', () => hover(chapterIndex));
    item.addEventListener('focus', () => hover(chapterIndex, item.matches(':focus-visible')));
    root.append(item);
    return { item, dot, title: faces[0].lastChild, fill: faces[1] };
  });
  root.addEventListener('pointerleave', (event) => {
    if (!card.contains(event.relatedTarget)) leave();
  });
  card.addEventListener('pointerenter', () => intent.stay());
  card.addEventListener('pointerleave', (event) => {
    if (!root.contains(event.relatedTarget)) leave();
  });
  ctx.host.append(root, card);
  cardKeyboard({ groups: items.map((entry) => [entry.item]), card, shown: () => (card.classList.contains('is-on') ? hovered : -1), leave: () => leave() });
  let shownCurrent = null;
  let hovered = -1;
  let shownState = '';

  function place(chapterIndex) {
    const box = items[chapterIndex].dot.getBoundingClientRect();
    const column = root.getBoundingClientRect();
    const left = column.right + 14;
    const floor = floorFor(left);
    card.style.maxHeight = `${floor - 12}px`;
    const height = Math.min(card.scrollHeight, floor - 12);
    card.style.left = `${left}px`;
    card.style.top = `${clamp(box.top + Math.min(box.height, 6) / 2 - 34, 12, floor - height)}px`;
  }
  function hover(chapterIndex, now = false) {
    items.forEach((entry, entryIndex) => entry.item.classList.toggle('is-hover', entryIndex === chapterIndex));
    intent.enter(() => {
      const wasOn = card.classList.contains('is-on');
      if (hovered !== chapterIndex || !wasOn) {
        card.replaceChildren(chapterCard(ctx, chapterIndex, ctx.state()));
        card.scrollTop = 0;
      }
      hovered = chapterIndex;
      card.classList.toggle('is-snap', !wasOn);
      place(chapterIndex);
      card.getBoundingClientRect();
      card.classList.remove('is-snap');
      card.classList.add('is-on');
    }, now);
  }
  function leave() {
    intent.leave(() => {
      card.classList.remove('is-on');
      hovered = -1;
      items.forEach((entry) => entry.item.classList.remove('is-hover'));
    });
  }
  function measure() {
    const room = innerHeight - TOP_MIN - BOTTOM_ROOM;
    const count = items.length;
    const pitch = Math.min(DOT_PITCH, Math.max(8, (room - CAPSULE_EDGES) / count));
    root.style.setProperty('--dot-pitch', `${pitch}px`);
    const entry = items[shownCurrent];
    const limit = Math.max(0, Math.min(TITLE_MAX, room - count * pitch - CAPSULE_EDGES));
    const title = Math.min(entry.title.scrollHeight, limit);
    root.style.setProperty('--capsule-title', `${limit}px`);
    entry.dot.style.setProperty('--capsule-height', `${title + CAPSULE_EDGES}px`);
    root.style.top = `${Math.round(clamp(innerHeight * TOP_SHARE, TOP_MIN, innerHeight - BOTTOM_ROOM - count * pitch - title - CAPSULE_EDGES))}px`;
    root.style.left = `${Math.max(16, ctx.article.getBoundingClientRect().left - 76)}px`;
  }
  return {
    columns: [root],
    update(state) {
      if (ctx.jumping() && shownCurrent !== null) return;
      const current = Math.max(0, state.chapter);
      items.forEach((entry, entryIndex) => {
        entry.item.classList.toggle('is-read', entryIndex < current);
        entry.item.classList.toggle('is-current', entryIndex === current);
      });
      if (shownCurrent !== current) {
        if (shownCurrent === null) {
          for (const entry of items) entry.dot.style.transition = 'none';
          requestAnimationFrame(() => items.forEach((entry) => (entry.dot.style.transition = '')));
        }
        shownCurrent = current;
        measure();
      }
      items.forEach((entry, entryIndex) => entry.fill.style.setProperty('--progress', entryIndex === current && state.chapter >= 0 ? state.progress.toFixed(4) : '0'));
      const key = stateKey(state);
      if (hovered >= 0 && card.classList.contains('is-on') && key !== shownState) {
        const scrollTop = card.scrollTop;
        card.replaceChildren(chapterCard(ctx, hovered, state));
        card.scrollTop = scrollTop;
      }
      shownState = key;
    },
    relayout() {
      if (shownCurrent !== null) measure();
    },
    destroy() {
      intent.stop();
      root.remove();
      card.remove();
    },
  };
}
