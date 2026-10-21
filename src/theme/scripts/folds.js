import { requestLayout } from './layout.js';
import { EASING, reducedMotion } from './motion.js';

const OPEN_DURATION = 220;
const CLOSE_DURATION = 140;
const CONTENT = '::details-content';
const SHOWN = { opacity: 1, transform: 'none' };
const ENTERING = { opacity: 0, transform: 'translateY(-6px)' };
const LEAVING = { opacity: 0, transform: 'translateY(-4px)' };
const closing = new WeakSet();
const running = new WeakMap();

export function startFolds(article) {
  const openedForPrint = [];
  const click = (event) => {
    const summary = event.target.closest('summary');
    const fold = summary?.parentElement;
    if (fold === null || fold === undefined || !fold.matches('details.fold') || !article.contains(fold)) return;
    event.preventDefault();
    toggleFold(fold);
  };
  const beforePrint = () => {
    for (const fold of article.querySelectorAll('details.fold')) {
      const wasOpen = fold.open && !closing.has(fold);
      settle(fold, true);
      if (!wasOpen) openedForPrint.push(fold);
    }
  };
  const afterPrint = () => {
    for (const fold of openedForPrint.splice(0)) fold.open = false;
    requestLayout();
  };
  const controller = new AbortController();
  const { signal } = controller;
  article.addEventListener('click', click, { signal });
  addEventListener('beforeprint', beforePrint, { signal });
  addEventListener('afterprint', afterPrint, { signal });
  return () => controller.abort();
}

export function openFoldsAround(target) {
  let opened = false;
  for (let fold = target.closest('details.fold'); fold !== null; fold = fold.parentElement.closest('details.fold')) {
    if (fold === target || (fold.open && !closing.has(fold))) continue;
    settle(fold, true);
    opened = true;
  }
  if (opened) requestLayout();
}

function toggleFold(fold) {
  const opening = !fold.open || closing.has(fold);
  if (reducedMotion.matches) {
    settle(fold, opening);
    requestLayout();
    return;
  }
  const from = fold.open ? { opacity: Number(getComputedStyle(fold, CONTENT).opacity), transform: getComputedStyle(fold, CONTENT).transform } : ENTERING;
  settle(fold, true);
  if (opening) {
    requestLayout();
    const animation = fold.animate([from, SHOWN], { pseudoElement: CONTENT, duration: OPEN_DURATION, easing: EASING });
    running.set(fold, animation);
    animation.finished.then(() => requestLayout(), () => {});
    return;
  }
  closing.add(fold);
  const animation = fold.animate([from, LEAVING], { pseudoElement: CONTENT, duration: CLOSE_DURATION, easing: EASING, fill: 'forwards' });
  running.set(fold, animation);
  animation.finished.then(
    () => {
      settle(fold, false);
      requestLayout();
    },
    () => {},
  );
}

function settle(fold, open) {
  closing.delete(fold);
  running.get(fold)?.cancel();
  running.delete(fold);
  fold.open = open;
}
