import { flash, reducedMotion } from 'bake/theme/client';

const NOTE = '.sidenote-ref, .bk-sidenote';

export function startNotes(article) {
  let active = null;
  const highlight = (number, on) => {
    for (const element of article.querySelectorAll(`:is(${NOTE})[data-sidenote="${number}"]`)) element.classList.toggle('is-active', on);
  };
  const activate = (number) => {
    if (number === active) return;
    if (active !== null) highlight(active, false);
    active = number;
    if (active !== null) highlight(active, true);
  };
  article.addEventListener('pointerover', (event) => {
    const target = event.target.closest(NOTE);
    if (target !== null) activate(target.dataset.sidenote);
  });
  article.addEventListener('pointerout', (event) => {
    const target = event.target.closest(NOTE);
    if (target !== null && !target.contains(event.relatedTarget)) activate(null);
  });
  article.addEventListener('click', (event) => {
    const link = event.target.closest('.sidenote-ref a');
    if (link === null || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const note = article.querySelector(`.bk-sidenote[data-sidenote="${link.parentElement.dataset.sidenote}"]`);
    if (note === null) return;
    event.preventDefault();
    const box = note.getBoundingClientRect();
    if (box.top < 0 || box.bottom > innerHeight) note.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'instant' : 'smooth' });
    flash(note);
  });
}
