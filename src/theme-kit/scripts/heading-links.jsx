import { elementOfFragment } from 'bake/fragments';
import { labelsFor } from '../labels.js';
import { openFoldsAround } from './folds.js';
import { flash, reducedMotion } from './motion.js';
import { showToast } from './toast.jsx';

const JUMP_MARGIN = 24;
const SCROLL_TIMEOUT = 1500;
const FLASHED = 'h1, h2, h3, h4, h5, h6, p, li, aside, .bk-block';
let jumpedOnLoad = false;

function jumpTo(target, { smooth = true } = {}) {
  openFoldsAround(target);
  const bottom = document.documentElement.scrollHeight - innerHeight;
  const top = Math.min(bottom, Math.max(0, target.getBoundingClientRect().top + scrollY - JUMP_MARGIN));
  const instant = !smooth || reducedMotion.matches || Math.abs(scrollY - top) < 2;
  scrollTo({ top, behavior: instant ? 'instant' : 'smooth' });
  flash(target.matches(FLASHED) ? target : (target.closest(FLASHED) ?? target));
  return instant ? Promise.resolve() : scrollEnd();
}

export function followLink(hash) {
  const target = elementOfFragment(document, hash);
  if (target === null) return Promise.resolve();
  history.pushState(null, '', hash);
  return jumpTo(target);
}

function scrollEnd() {
  return new Promise((done) => {
    const finish = () => {
      clearTimeout(timer);
      removeEventListener('scrollend', finish);
      done();
    };
    const timer = setTimeout(finish, SCROLL_TIMEOUT);
    addEventListener('scrollend', finish);
  });
}

export function startHeadingLinks() {
  const labels = labelsFor(document.documentElement.lang);
  const click = (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href^="#"]');
    if (link === null || link.closest('.sidenote-ref') !== null) return;
    const hash = link.getAttribute('href');
    const target = elementOfFragment(document, hash);
    if (target === null) return;
    event.preventDefault();
    if (link.classList.contains('bk-heading-link')) {
      copyLink(hash, labels);
      return;
    }
    followLink(hash);
  };
  document.addEventListener('click', click);
  if (!jumpedOnLoad) {
    jumpedOnLoad = true;
    const initial = elementOfFragment(document, location.hash);
    if (initial !== null) requestAnimationFrame(() => jumpTo(initial, { smooth: false }));
  }
  return () => document.removeEventListener('click', click);
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
