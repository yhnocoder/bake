import { markCurrent, reducedMotion } from 'bake/theme/client';
import { createElement, withoutTransition } from './toc-card.js';
import { ticksColumn } from './toc-ticks.js';

export const RAIL_CARD = { variant: 'panel', showDelay: 160 };
const FOLLOW_DELAY = 360;
const TOP_FADE_SHARE = 0.16;
const MARKER_HEIGHT = 100;

export function notesView(view) {
  const column = view.nav.querySelector('.bk-toc-column');
  const list = notesList(view.nav.querySelector('.bk-toc-list'), view.outline);
  let columnTop = null;
  return {
    columns: [column],
    update(state) {
      const top = `${Math.max(0, Math.round(column.getBoundingClientRect().top))}px`;
      if (top !== columnTop) column.style.setProperty('--column-top', top);
      columnTop = top;
      list.update(state);
    },
    relayout: list.relayout,
    destroy: list.destroy,
  };
}

export function railView(view) {
  const panel = view.card.frame;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', view.labels.notes);
  const source = view.nav.querySelector('.bk-toc-list').cloneNode(true);
  for (const marker of source.querySelectorAll('.bk-toc-marker')) marker.remove();
  panel.append(createElement('p', 'bk-toc-label', view.labels.notes), source);
  const list = notesList(source, view.outline);
  const ticks = ticksColumn(view, true);
  view.host.append(ticks.element);
  return {
    columns: [ticks.element],
    chapters: ticks.chapters,
    shown: () => list.centre(false, true),
    update(state) {
      ticks.update(state);
      list.update(state);
    },
    relayout() {
      ticks.relayout();
      list.relayout();
    },
    destroy() {
      list.destroy();
      ticks.element.remove();
    },
  };
}

function notesList(list, outline) {
  const abort = new AbortController();
  const { signal } = abort;
  const inner = list.querySelector('.bk-toc-chapters');
  const marker = createElement('li', 'bk-toc-marker');
  marker.setAttribute('aria-hidden', 'true');
  inner.prepend(marker);
  const chapters = [...inner.querySelectorAll('.bk-toc-chapter')].map((box) => ({
    box,
    title: box.querySelector('.bk-toc-chapter-title'),
    recap: box.querySelector('.bk-toc-chapter-recap'),
    sections: [...box.querySelectorAll('.bk-toc-section')],
  }));
  const rows = chapters.flatMap((chapter) => [chapter.title, ...chapter.sections]);
  let current = -1;
  let shown = null;
  let drawn = null;
  let followTimer = 0;
  let hovered = false;

  list.addEventListener('scroll', () => list.style.setProperty('--fade-top', `${Math.min(list.scrollTop, list.clientHeight * TOP_FADE_SHARE)}px`), { passive: true, signal });
  list.addEventListener('pointerenter', () => (hovered = true), { signal });
  list.addEventListener(
    'pointerleave',
    () => {
      hovered = false;
      centre(true);
    },
    { signal },
  );
  const resize = new ResizeObserver(() => placeMarker());
  resize.observe(inner);

  function centre(smooth, force) {
    if ((!force && hovered) || !list.isConnected || list.clientHeight === 0) return;
    const target = rows[Math.max(current - 1, 0)];
    if (target === undefined) return;
    const listBox = list.getBoundingClientRect();
    const rowBox = target.getBoundingClientRect();
    const top = list.scrollTop + rowBox.top - listBox.top + rowBox.height / 2 - list.clientHeight / 2;
    if (Math.abs(list.scrollTop - top) > 1) list.scrollTo({ top, behavior: smooth && !reducedMotion.matches ? 'smooth' : 'instant' });
  }

  function placeInstantly() {
    withoutTransition([marker], placeMarker);
  }

  function placeMarker() {
    const target = current >= 0 ? rows[current] : undefined;
    if (target === undefined || list.clientHeight === 0) {
      marker.classList.remove('is-on');
      return;
    }
    const chapter = target.matches('.bk-toc-chapter-title');
    const title = chapter ? target : target.querySelector('.bk-toc-section-title');
    const offset = title.getBoundingClientRect().top - inner.getBoundingClientRect().top;
    const padding = chapter ? parseFloat(getComputedStyle(title).paddingTop) : 0;
    const top = offset + (chapter ? padding - 2 : 3);
    const height = title.offsetHeight - (chapter ? padding + 1 : 6);
    marker.style.transform = `translateY(${top}px) scaleY(${height / MARKER_HEIGHT})`;
    // why: classList.add writes the class attribute even when the class is already there, and toggle with true does not
    marker.classList.toggle('is-on', true);
  }

  return {
    centre,
    relayout: placeInstantly,
    update(state) {
      const key = `${state.entry} ${state.chapter} ${state.section} ${state.read.join()}`;
      if (key === drawn) return;
      drawn = key;
      current = state.entry;
      chapters.forEach((chapter, chapterIndex) => {
        const relation = chapterIndex < state.chapter ? 'read' : chapterIndex === state.chapter ? 'current' : 'ahead';
        if (chapter.box.dataset.state !== relation) chapter.box.dataset.state = relation;
        markCurrent(chapter.title, relation === 'current' && state.section === -1);
        const first = outline.chapters[chapterIndex].index;
        chapter.recap?.classList.toggle('is-read', state.read[first]);
        chapter.sections.forEach((row, sectionIndex) => {
          const index = first + 1 + sectionIndex;
          const rowState = index === state.entry ? 'current' : index < state.entry ? 'read' : 'ahead';
          if (row.dataset.state !== rowState) row.dataset.state = rowState;
          markCurrent(row.querySelector('.bk-toc-section-title'), rowState === 'current');
          row.classList.toggle('is-read', state.read[index]);
        });
      });
      placeMarker();
      if (state.entry === shown) return;
      const first = shown === null;
      shown = state.entry;
      clearTimeout(followTimer);
      if (first) requestAnimationFrame(() => centre(false, true));
      else followTimer = setTimeout(() => centre(true), FOLLOW_DELAY);
    },
    destroy() {
      abort.abort();
      resize.disconnect();
      clearTimeout(followTimer);
      marker.remove();
    },
  };
}
