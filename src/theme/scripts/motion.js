export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

export const CONTENT_EVENT = 'bake:content';

export const EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

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
