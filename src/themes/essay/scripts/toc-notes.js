import { closeOnEscape, reducedMotion } from 'bake/theme/client';
import { createElement } from './toc-card.js';
import { ticksColumn } from './toc-ticks.js';

const FOLLOW_DELAY = 360;
const TOP_FADE_SHARE = 0.16;
const OPEN_DELAY = 160;
const CLOSE_DELAY = 220;

export function notesColumn(nav, context) {
  const column = nav.querySelector('.bk-toc-column');
  const list = notesList(nav.querySelector('.bk-toc-list'), context);
  let columnTop = null;
  return {
    update(state) {
      const top = `${Math.max(0, Math.round(column.getBoundingClientRect().top))}px`;
      if (top !== columnTop) column.style.setProperty('--column-top', top);
      columnTop = top;
      list.update(state);
    },
    relayout: list.relayout,
    show: () => requestAnimationFrame(() => list.centre(false, true)),
    destroy: list.destroy,
  };
}

export function notesRailView(context) {
  const panel = createElement('div', 'bk-toc-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', context.labels.notes);
  panel.append(createElement('p', 'bk-toc-label', context.labels.notes));
  const source = document.querySelector('.bk-toc .bk-toc-list').cloneNode(true);
  for (const marker of source.querySelectorAll('.bk-toc-marker')) marker.remove();
  panel.append(source);
  const list = notesList(source, context);
  let openTimer = 0;
  let closeTimer = 0;
  const isOpen = () => panel.classList.contains('is-open');
  const open = () => {
    clearTimeout(closeTimer);
    if (isOpen()) return;
    panel.classList.add('is-open');
    list.centre(false, true);
  };
  const close = (delay = CLOSE_DELAY) => {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => panel.classList.remove('is-open'), delay);
  };
  const ticks = ticksColumn(context, {
    rail: true,
    hover(index) {
      ticks.hover(index);
      clearTimeout(closeTimer);
      clearTimeout(openTimer);
      openTimer = setTimeout(open, OPEN_DELAY);
    },
    leave() {
      ticks.hover(-1);
      clearTimeout(openTimer);
      close();
    },
    click: open,
  });
  panel.addEventListener('pointerenter', () => clearTimeout(closeTimer));
  panel.addEventListener('pointerleave', () => close());
  panel.addEventListener('click', (event) => {
    if (event.target.closest('a') !== null) close(0);
  });
  for (const element of [ticks.element, panel]) {
    element.addEventListener('focusout', (event) => {
      const next = event.relatedTarget;
      if (!(next instanceof Node) || (!ticks.element.contains(next) && !panel.contains(next))) close();
    });
  }
  context.host.append(ticks.element, panel);
  closeOnEscape(panel, () => {
    const wasOpen = isOpen();
    close(0);
    return wasOpen;
  });
  return {
    columns: [ticks.element],
    update(state) {
      ticks.update(state);
      list.update(state);
    },
    relayout() {
      ticks.relayout();
      list.relayout();
    },
    destroy() {
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
      list.destroy();
      ticks.element.remove();
      panel.remove();
    },
  };
}

function notesList(list, context) {
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
    marker.style.transform = `translateY(${top}px)`;
    marker.style.height = `${height}px`;
    marker.classList.add('is-on');
  }

  return {
    centre,
    relayout: placeMarker,
    update(state) {
      const key = `${state.entry} ${state.chapter} ${state.section} ${state.read.join()}`;
      if (key === drawn) return;
      drawn = key;
      current = state.entry;
      chapters.forEach((chapter, chapterIndex) => {
        const relation = chapterIndex < state.chapter ? 'read' : chapterIndex === state.chapter ? 'current' : 'ahead';
        chapter.box.dataset.state = relation;
        chapter.box.toggleAttribute('data-here', relation === 'current' && state.section === -1);
        const first = context.outline.chapters[chapterIndex].index;
        chapter.recap?.classList.toggle('is-read', state.read[first]);
        chapter.sections.forEach((row, sectionIndex) => {
          const index = first + 1 + sectionIndex;
          row.dataset.state = index === state.entry ? 'current' : index < state.entry ? 'read' : 'ahead';
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
