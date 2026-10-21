import { SETTING_EVENT, notesColumnScreen } from 'bake/theme/client';

const TOP_ZONE = 40;
const TRAVEL = 8;
const HIDDEN_CLASS = 'bk-buttons-hidden';

let travel = 0;
let jumping = false;

export function startButtons() {
  const root = document.documentElement;
  const autohide = () => root.dataset.buttons === 'autohide';
  let lastTop = scrollY;
  const scroll = () => {
    const top = scrollY;
    const delta = top - lastTop;
    lastTop = top;
    if (jumping) return;
    if (notesColumnScreen.matches || !autohide() || root.classList.contains('bk-toc-drawer-open') || document.querySelector('.bk-settings.is-open') !== null || top < TOP_ZONE) {
      showButtons();
      return;
    }
    travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
    if (travel > TRAVEL) hideButtons();
    else if (travel < -TRAVEL) showButtons();
  };
  const setting = (event) => {
    if (event.detail.name === 'buttons' && !autohide()) showButtons();
  };
  const controller = new AbortController();
  const { signal } = controller;
  addEventListener('scroll', scroll, { passive: true, signal });
  notesColumnScreen.addEventListener('change', showButtons, { signal });
  document.addEventListener(SETTING_EVENT, setting, { signal });
  return () => controller.abort();
}

export function showButtonsDuring(jump) {
  jumping = true;
  showButtons();
  jump.then(() => requestAnimationFrame(() => (jumping = false)));
}

function showButtons() {
  travel = 0;
  if (document.documentElement.classList.contains(HIDDEN_CLASS)) document.documentElement.classList.remove(HIDDEN_CLASS);
}

function hideButtons() {
  if (!document.documentElement.classList.contains(HIDDEN_CLASS)) document.documentElement.classList.add(HIDDEN_CLASS);
}
