import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

const TOAST_DURATION = 1400;

const [toastText, setToastText] = createSignal('');
const [toastShown, setToastShown] = createSignal(false);
let toastTimer;

export function startToast() {
  const host = document.createElement('div');
  document.body.append(host);
  const dispose = render(() => <Toast />, host);
  return () => {
    dispose();
    host.remove();
  };
}

export function showToast(text) {
  setToastText(text);
  setToastShown(true);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setToastShown(false), TOAST_DURATION);
}

function Toast() {
  return (
    <div class="bk-toast" classList={{ 'is-on': toastShown() }} role="status">
      {toastText()}
    </div>
  );
}
