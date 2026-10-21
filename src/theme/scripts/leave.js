import { reducedMotion } from './motion.js';

const FADE = 80;

// why: Arc blanks the page and then shows the old page again before the next one paints; once the old page has faded to the background colour, those frames look like the fade itself
export function startLeaveFade() {
  let fades = [];
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (!(link instanceof HTMLAnchorElement) || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || reducedMotion.matches) return;
    if ((link.target !== '' && link.target !== '_self') || link.hasAttribute('download')) return;
    const url = new URL(link.href);
    if (url.origin !== location.origin || (url.hash !== '' && url.pathname === location.pathname && url.search === location.search)) return;
    event.preventDefault();
    fades = [...document.body.children].map((part) => part.animate({ opacity: [1, 0] }, { duration: FADE, easing: 'ease-out', fill: 'forwards' }));
    Promise.all(fades.map((fade) => fade.finished)).then(() => location.assign(url));
  });
  addEventListener('pageshow', (event) => {
    if (event.persisted) fades.forEach((fade) => fade.cancel());
  });
}
