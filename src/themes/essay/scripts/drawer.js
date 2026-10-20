import { closeOnEscape } from 'bake/theme/client';
import { chapterCard, createElement } from './toc-card.js';

const CLOSE_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

export function drawerView(view) {
  const { outline, labels, state } = view;
  const root = document.documentElement;
  const dots = view.style === 'dots';
  const handle = createElement('button', dots ? 'bk-toc-handle is-capsule' : 'bk-toc-handle is-tab');
  handle.type = 'button';
  handle.setAttribute('aria-label', labels.openToc);
  handle.setAttribute('aria-expanded', 'false');
  handle.setAttribute('aria-controls', 'bk-toc-drawer');
  const capsule = createElement('span', 'bk-toc-handle-capsule');
  capsule.append(createElement('i'));
  const number = createElement('span', 'bk-toc-handle-number');
  if (dots) handle.append(capsule);
  handle.append(number);
  const scrim = createElement('div', 'bk-toc-drawer-scrim');
  const drawer = createElement('div', 'bk-toc-drawer');
  drawer.id = 'bk-toc-drawer';
  drawer.tabIndex = -1;
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-label', labels.toc);
  const head = createElement('div', 'bk-toc-drawer-head');
  head.append(createElement('p', 'bk-toc-drawer-label', labels.toc));
  const close = createElement('button', 'bk-toc-drawer-close');
  close.type = 'button';
  close.setAttribute('aria-label', labels.close);
  close.innerHTML = CLOSE_ICON;
  head.append(close);
  const split = createElement('div', 'bk-toc-drawer-split');
  const index = createElement('div', dots ? 'bk-toc-drawer-index is-dots' : 'bk-toc-drawer-index');
  const detail = createElement('div', 'bk-toc-drawer-detail');
  split.append(index, detail);
  drawer.append(head, split);
  view.host.append(scrim, drawer, handle);
  const buttons = outline.chapters.map((chapter, chapterIndex) => {
    const button = createElement('button', dots ? 'bk-toc-drawer-dot' : 'bk-toc-drawer-tab', dots ? undefined : chapter.number);
    button.type = 'button';
    button.setAttribute('aria-label', `${chapter.number} ${chapter.title}`);
    if (dots) button.append(createElement('i'));
    button.addEventListener('click', () => select(chapterIndex));
    index.append(button);
    return button;
  });

  const isOpen = () => drawer.classList.contains('is-open');
  let selected = 0;
  function select(chapterIndex) {
    selected = chapterIndex;
    buttons.forEach((button, buttonIndex) => {
      button.classList.toggle('is-selected', buttonIndex === chapterIndex);
      button.setAttribute('aria-pressed', String(buttonIndex === chapterIndex));
    });
    detail.replaceChildren(chapterCard(view, chapterIndex, state()));
    detail.scrollTop = 0;
  }
  function setOpen(open) {
    drawer.classList.toggle('is-open', open);
    scrim.classList.toggle('is-open', open);
    root.classList.toggle('bk-toc-drawer-open', open);
    handle.setAttribute('aria-expanded', String(open));
    if (!open) return;
    select(Math.max(0, state().chapter));
    drawer.focus({ preventScroll: true });
  }
  handle.addEventListener('click', () => setOpen(true));
  scrim.addEventListener('click', () => setOpen(false));
  close.addEventListener('click', () => {
    setOpen(false);
    handle.focus();
  });
  closeOnEscape(drawer, () => {
    if (!isOpen()) return;
    setOpen(false);
    handle.focus();
  });

  let progress = null;
  return {
    update(next) {
      const text = next.chapter < 0 ? labels.toc : outline.chapters[next.chapter].number;
      if (number.textContent !== text) number.textContent = text;
      const shown = next.progress.toFixed(3);
      if (shown !== progress) capsule.style.setProperty('--progress', shown);
      progress = shown;
      buttons.forEach((button, buttonIndex) => {
        button.classList.toggle('is-current', buttonIndex === Math.max(0, next.chapter));
        button.classList.toggle('is-read', buttonIndex < next.chapter);
      });
    },
    refresh() {
      if (!isOpen()) return;
      const scrollTop = detail.scrollTop;
      detail.replaceChildren(chapterCard(view, selected, state()));
      detail.scrollTop = scrollTop;
    },
    saved() {
      return isOpen() ? { selected, detail: detail.scrollTop, index: index.scrollTop } : null;
    },
    restore(saved) {
      drawer.classList.add('is-open');
      scrim.classList.add('is-open');
      root.classList.add('bk-toc-drawer-open');
      handle.setAttribute('aria-expanded', 'true');
      select(Math.min(saved.selected, buttons.length - 1));
      detail.scrollTop = saved.detail;
      index.scrollTop = saved.index;
      if (document.activeElement === document.body) drawer.focus({ preventScroll: true });
    },
    jumped() {
      if (isOpen()) setOpen(false);
    },
    destroy() {
      root.classList.remove('bk-toc-drawer-open');
      handle.remove();
      scrim.remove();
      drawer.remove();
    },
  };
}
