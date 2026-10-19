export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

export const LAYOUT_EVENT = 'bk:layout';

export const CONTENT_EVENT = 'bake:content';

const COLLAPSED = { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', marginBottom: '0px', opacity: 0 };
const EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

export function layoutChanged() {
  document.dispatchEvent(new CustomEvent(LAYOUT_EVENT));
}

export function oncePerFrame(callback) {
  let pending = false;
  return () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      callback();
    });
  };
}

export function animateHeight(element, from, to, { opacity = [1, 1], duration = 220 } = {}) {
  element.style.overflowY = 'clip';
  element.style.boxSizing = 'border-box';
  const animation = element.animate(
    [
      { height: `${from}px`, opacity: opacity[0] },
      { height: `${to}px`, opacity: opacity[1] },
    ],
    { duration, easing: EASING, fill: 'forwards' },
  );
  return finished(animation);
}

export function expand(element, opening, { duration = 200 } = {}) {
  const height = element.getBoundingClientRect().height;
  element.style.overflowY = 'clip';
  const keyframes = opening ? [COLLAPSED, { height: `${height}px`, opacity: 1 }] : [{ height: `${height}px`, opacity: 1 }, COLLAPSED];
  return finished(element.animate(keyframes, { duration, easing: EASING, fill: 'forwards' }));
}

export function stopAnimations(element) {
  for (const animation of element.getAnimations()) animation.cancel();
  element.style.removeProperty('overflow-y');
  element.style.removeProperty('box-sizing');
}

export function flash(element) {
  element.classList.remove('bk-flash');
  element.getBoundingClientRect();
  element.classList.add('bk-flash');
  const end = (event) => {
    if (event.target !== element || event.animationName !== 'bk-flash') return;
    element.classList.remove('bk-flash');
    element.removeEventListener('animationend', end);
  };
  element.addEventListener('animationend', end);
}

function finished(animation) {
  return animation.finished.then(
    () => true,
    () => false,
  );
}
