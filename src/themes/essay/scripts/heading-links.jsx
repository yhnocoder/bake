import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { labelsFor } from '../labels.js';
import { openFoldsAround } from './folds.js';
import { flash, reducedMotion } from './motion.js';

const JUMP_MARGIN = 24;
const TOAST_DURATION = 1400;
const FLASHED = 'h1, h2, h3, h4, h5, h6, p, li, aside, .bk-block';

const [toastText, setToastText] = createSignal('');
const [toastShown, setToastShown] = createSignal(false);
let toastTimer;

export function showToast(text) {
  setToastText(text);
  setToastShown(true);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setToastShown(false), TOAST_DURATION);
}

export function jumpTo(target, { smooth = true } = {}) {
  openFoldsAround(target);
  const top = target.getBoundingClientRect().top + scrollY - JUMP_MARGIN;
  scrollTo({ top, behavior: smooth && !reducedMotion.matches ? 'smooth' : 'instant' });
  flash(target.matches(FLASHED) ? target : (target.closest(FLASHED) ?? target));
}

export function startHeadingLinks() {
  const labels = labelsFor(document.documentElement.lang);
  const host = document.createElement('div');
  document.body.append(host);
  render(() => <Toast />, host);
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href^="#"]');
    if (link === null || link.closest('.sidenote-ref') !== null) return;
    const hash = link.getAttribute('href');
    const target = targetOf(hash);
    if (target === null) return;
    event.preventDefault();
    if (link.classList.contains('bk-heading-link')) {
      copyLink(hash, labels);
      return;
    }
    history.pushState(null, '', hash);
    jumpTo(target);
  });
  const initial = targetOf(location.hash);
  if (initial !== null) requestAnimationFrame(() => jumpTo(initial, { smooth: false }));
}

function targetOf(hash) {
  if (hash.length < 2) return null;
  try {
    return document.getElementById(decodeURIComponent(hash.slice(1)));
  } catch {
    return null;
  }
}

function copyLink(hash, labels) {
  const url = `${location.href.split('#')[0]}${hash}`;
  history.replaceState(null, '', hash);
  const copied = navigator.clipboard === undefined ? Promise.reject(new Error('no clipboard')) : navigator.clipboard.writeText(url);
  copied.then(
    () => showToast(labels.linkCopied),
    () => showToast(url),
  );
}

function Toast() {
  return (
    <div class="bk-toast" classList={{ 'is-on': toastShown() }} role="status">
      {toastText()}
    </div>
  );
}
