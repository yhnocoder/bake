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
  addEventListener(
    'scroll',
    () => {
      const top = scrollY;
      const delta = top - lastTop;
      lastTop = top;
      if (jumping) return;
      if (notesColumnScreen.matches || !autohide() || root.classList.contains('bk-drawer-open') || document.querySelector('.bk-settings.is-open') !== null || top < TOP_ZONE) {
        showButtons();
        return;
      }
      travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
      if (travel > TRAVEL) hideButtons();
      else if (travel < -TRAVEL) showButtons();
    },
    { passive: true },
  );
  notesColumnScreen.addEventListener('change', showButtons);
  document.addEventListener(SETTING_EVENT, (event) => {
    if (event.detail.name === 'buttons' && !autohide()) showButtons();
  });
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
