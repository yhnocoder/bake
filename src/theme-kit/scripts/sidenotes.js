// why: a note opened below its paragraph on a narrow screen is already marked by its expanded reference, and pointing at it does not highlight the paragraph
const TRIGGER = '.sidenote-ref, .bk-sidenote:not(.is-open)';

export function startSidenoteHighlight(article, onChange) {
  let active = null;
  const highlight = (number, on) => {
    for (const element of article.querySelectorAll(`:is(.sidenote-ref, .bk-sidenote)[data-sidenote="${number}"]`)) element.classList.toggle('is-active', on);
    onChange?.(number, on);
  };
  const activate = (number) => {
    if (active !== null && active !== number) highlight(active, false);
    active = number;
    if (active !== null) highlight(active, true);
  };
  const over = (event) => {
    const target = event.target.closest(TRIGGER);
    if (target !== null) activate(target.dataset.sidenote);
  };
  const out = (event) => {
    const target = event.target.closest(TRIGGER);
    if (target !== null && !target.contains(event.relatedTarget)) activate(null);
  };
  article.addEventListener('pointerover', over);
  article.addEventListener('pointerout', out);
  return () => {
    article.removeEventListener('pointerover', over);
    article.removeEventListener('pointerout', out);
    activate(null);
  };
}
