import { animateHeight, layoutChanged, reducedMotion, stopAnimations } from './motion.js';

const OPEN_DURATION = 220;
const CLOSE_DURATION = 180;
const targets = new WeakMap();

export function startFolds(article) {
  article.addEventListener('click', (event) => {
    const summary = event.target.closest('summary');
    const fold = summary?.parentElement;
    if (fold === null || fold === undefined || !fold.matches('details.fold') || !article.contains(fold)) return;
    event.preventDefault();
    toggleFold(fold);
  });
  const openedForPrint = [];
  addEventListener('beforeprint', () => {
    for (const fold of article.querySelectorAll('details.fold')) {
      const wasOpen = targets.get(fold) ?? fold.open;
      settle(fold, true);
      if (!wasOpen) openedForPrint.push(fold);
    }
  });
  addEventListener('afterprint', () => {
    for (const fold of openedForPrint.splice(0)) fold.open = false;
    layoutChanged();
  });
}

export function openFoldsAround(target) {
  let opened = false;
  for (let fold = target.closest('details.fold'); fold !== null; fold = fold.parentElement.closest('details.fold')) {
    if (fold === target || (targets.get(fold) ?? fold.open)) continue;
    settle(fold, true);
    opened = true;
  }
  if (opened) layoutChanged();
}

function toggleFold(fold) {
  const opening = !(targets.get(fold) ?? fold.open);
  if (reducedMotion.matches) {
    settle(fold, opening);
    layoutChanged();
    return;
  }
  const content = [...fold.children].filter((child) => child.tagName !== 'SUMMARY');
  const from = fold.getBoundingClientRect().height;
  const opacities = content.map((child) => Number(getComputedStyle(child).opacity));
  settle(fold, false);
  const closed = fold.getBoundingClientRect().height;
  fold.open = true;
  const open = fold.getBoundingClientRect().height;
  targets.set(fold, opening);
  const timing = { duration: opening ? OPEN_DURATION : CLOSE_DURATION };
  content.forEach((child, index) => child.animate([{ opacity: opacities[index] }, { opacity: opening ? 1 : 0 }], { ...timing, fill: 'forwards' }));
  animateHeight(fold, from, opening ? open : closed, timing).then((done) => {
    if (!done) return;
    settle(fold, opening);
    layoutChanged();
  });
}

function settle(fold, open) {
  stopAnimations(fold);
  for (const child of fold.children) for (const animation of child.getAnimations()) animation.cancel();
  targets.delete(fold);
  fold.open = open;
}
