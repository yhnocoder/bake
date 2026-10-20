import { notesColumnScreen } from './screens.js';
import { SETTING_EVENT } from './settings.jsx';

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
      if (travel > TRAVEL) root.classList.add(HIDDEN_CLASS);
      else if (travel < -TRAVEL) root.classList.remove(HIDDEN_CLASS);
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
  document.documentElement.classList.remove(HIDDEN_CLASS);
}
