import { closeOnEscape } from 'bake/theme/client';

const OVERFLOWING = '.bt-card[data-overflow]';

export function startCardScroll(article) {
  let active = null;
  const deactivate = () => {
    if (active === null) return false;
    active.removeAttribute('data-active');
    active = null;
    return true;
  };
  const activate = (card) => {
    if (card === active) return;
    deactivate();
    if (card === null) return;
    active = card;
    card.setAttribute('data-active', '');
  };
  document.addEventListener('pointerdown', (event) => activate(event.target.closest?.(OVERFLOWING) ?? null));
  article.addEventListener('focusin', (event) => activate(event.target.closest(OVERFLOWING)));
  article.addEventListener('focusout', (event) => {
    if (active !== null && !active.contains(event.relatedTarget)) deactivate();
  });
  article.addEventListener(
    'scroll',
    (event) => {
      const card = event.target;
      if (!(card instanceof Element) || !card.matches(OVERFLOWING)) return;
      card.toggleAttribute('data-end', card.scrollTop + card.clientHeight >= card.scrollHeight - 1);
    },
    true,
  );
  closeOnEscape(article, deactivate);
}
