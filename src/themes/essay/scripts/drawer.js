import { closeOnEscape } from './escape.js';
import { chapterCard, createElement } from './toc-card.js';

const CLOSE_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

export function drawerView(context) {
  const { outline, labels } = context;
  const root = document.documentElement;
  const dots = root.dataset.toc === 'dots';
  const handle = createElement('button', dots ? 'bk-toc-handle is-capsule' : 'bk-toc-handle is-tab');
  handle.type = 'button';
  handle.setAttribute('aria-label', labels.openToc);
  handle.setAttribute('aria-expanded', 'false');
  handle.setAttribute('aria-controls', 'bk-drawer');
  const capsule = createElement('span', 'bk-handle-capsule');
  capsule.append(createElement('i'));
  const number = createElement('span', 'bk-handle-number');
  if (dots) handle.append(capsule);
  handle.append(number);
  const scrim = createElement('div', 'bk-drawer-scrim');
  const drawer = createElement('div', 'bk-drawer');
  drawer.id = 'bk-drawer';
  drawer.tabIndex = -1;
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-label', labels.toc);
  const head = createElement('div', 'bk-drawer-head');
  head.append(createElement('p', 'bk-drawer-label', labels.toc));
  const close = createElement('button', 'bk-drawer-close');
  close.type = 'button';
  close.setAttribute('aria-label', labels.close);
  close.innerHTML = CLOSE_ICON;
  head.append(close);
  const split = createElement('div', 'bk-drawer-split');
  const index = createElement('div', dots ? 'bk-drawer-index is-dots' : 'bk-drawer-index');
  const detail = createElement('div', 'bk-drawer-detail');
  split.append(index, detail);
  drawer.append(head, split);
  context.host.append(scrim, drawer, handle);
  const buttons = outline.chapters.map((chapter, chapterIndex) => {
    const button = createElement('button', dots ? 'bk-drawer-dot' : 'bk-drawer-tab', dots ? undefined : chapter.number);
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
    detail.replaceChildren(chapterCard(context, chapterIndex, context.state()));
    detail.scrollTop = 0;
  }
  function setOpen(open) {
    drawer.classList.toggle('is-open', open);
    scrim.classList.toggle('is-open', open);
    root.classList.toggle('bk-drawer-open', open);
    handle.setAttribute('aria-expanded', String(open));
    if (!open) return;
    select(Math.max(0, context.state().chapter));
    drawer.focus({ preventScroll: true });
  }
  handle.addEventListener('click', () => setOpen(true));
  scrim.addEventListener('click', () => setOpen(false));
  close.addEventListener('click', () => {
    setOpen(false);
    handle.focus();
  });
  closeOnEscape(drawer, () => {
    if (!isOpen()) return false;
    setOpen(false);
    handle.focus();
    return true;
  });

  return {
    update(state) {
      number.textContent = state.chapter < 0 ? labels.toc : outline.chapters[state.chapter].number;
      capsule.style.setProperty('--progress', state.progress.toFixed(3));
      buttons.forEach((button, buttonIndex) => {
        button.classList.toggle('is-current', buttonIndex === Math.max(0, state.chapter));
        button.classList.toggle('is-read', buttonIndex < state.chapter);
      });
    },
    saved() {
      return isOpen() ? { selected, detail: detail.scrollTop, index: index.scrollTop } : null;
    },
    restore(saved) {
      drawer.classList.add('is-open');
      scrim.classList.add('is-open');
      root.classList.add('bk-drawer-open');
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
      root.classList.remove('bk-drawer-open');
      handle.remove();
      scrim.remove();
      drawer.remove();
    },
  };
}
