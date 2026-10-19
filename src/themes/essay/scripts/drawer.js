import { SETTING_EVENT } from './settings.jsx';
import { chapterCard, el } from './toc-card.js';

const TOP_ZONE = 40;
const TRAVEL = 8;
const CLOSE_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

export function drawerView(ctx) {
  const { outline, labels } = ctx;
  const root = document.documentElement;
  const dots = root.dataset.toc === 'dots';
  const abort = new AbortController();
  const { signal } = abort;
  const handle = el('button', dots ? 'bk-toc-handle is-capsule' : 'bk-toc-handle is-tab');
  handle.type = 'button';
  handle.setAttribute('aria-label', labels.openToc);
  handle.setAttribute('aria-expanded', 'false');
  handle.setAttribute('aria-controls', 'bk-drawer');
  const capsule = el('span', 'bk-handle-capsule');
  capsule.append(el('i'));
  const number = el('span', 'bk-handle-number');
  if (dots) handle.append(capsule);
  handle.append(number);
  const scrim = el('div', 'bk-drawer-scrim');
  const drawer = el('div', 'bk-drawer');
  drawer.id = 'bk-drawer';
  drawer.tabIndex = -1;
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-label', labels.toc);
  const head = el('div', 'bk-drawer-head');
  head.append(el('p', 'bk-drawer-label', labels.toc));
  const close = el('button', 'bk-drawer-close');
  close.type = 'button';
  close.setAttribute('aria-label', labels.close);
  close.innerHTML = CLOSE_ICON;
  head.append(close);
  const split = el('div', 'bk-drawer-split');
  const index = el('div', dots ? 'bk-drawer-index is-dots' : 'bk-drawer-index');
  const detail = el('div', 'bk-drawer-detail');
  split.append(index, detail);
  drawer.append(head, split);
  ctx.host.append(scrim, drawer, handle);
  const buttons = outline.chapters.map((chapter, chapterIndex) => {
    const button = el('button', dots ? 'bk-drawer-dot' : 'bk-drawer-tab', dots ? undefined : chapter.number);
    button.type = 'button';
    button.setAttribute('aria-label', `${chapter.number} ${chapter.title}`);
    if (dots) button.append(el('i'));
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
    detail.replaceChildren(chapterCard(ctx, chapterIndex, ctx.state()));
    detail.scrollTop = 0;
  }
  function setOpen(open) {
    drawer.classList.toggle('is-open', open);
    scrim.classList.toggle('is-open', open);
    root.classList.toggle('bk-drawer-open', open);
    handle.setAttribute('aria-expanded', String(open));
    if (!open) return;
    select(Math.max(0, ctx.state().chapter));
    drawer.focus({ preventScroll: true });
  }
  handle.addEventListener('click', () => setOpen(true));
  scrim.addEventListener('click', () => setOpen(false));
  close.addEventListener('click', () => {
    setOpen(false);
    handle.focus();
  });
  addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || !isOpen()) return;
      setOpen(false);
      handle.focus();
    },
    { signal },
  );

  let lastTop = scrollY;
  let travel = 0;
  const hideButtons = (hidden) => root.classList.toggle('bk-buttons-hidden', hidden);
  const autohide = () => root.dataset.buttons === 'autohide';
  addEventListener(
    'scroll',
    () => {
      const top = scrollY;
      const delta = top - lastTop;
      lastTop = top;
      if (ctx.jumping()) return;
      if (!autohide() || isOpen() || document.querySelector('.bk-settings.is-open') !== null || top < TOP_ZONE) {
        travel = 0;
        hideButtons(false);
        return;
      }
      travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
      if (travel > TRAVEL) hideButtons(true);
      else if (travel < -TRAVEL) hideButtons(false);
    },
    { passive: true, signal },
  );
  document.addEventListener(
    SETTING_EVENT,
    (event) => {
      if (event.detail.name === 'buttons' && !autohide()) hideButtons(false);
    },
    { signal },
  );

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
      travel = 0;
      hideButtons(false);
      if (isOpen()) setOpen(false);
    },
    destroy() {
      abort.abort();
      root.classList.remove('bk-drawer-open', 'bk-buttons-hidden');
      handle.remove();
      scrim.remove();
      drawer.remove();
    },
  };
}
