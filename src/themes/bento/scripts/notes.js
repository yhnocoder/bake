import { flash, reducedMotion } from 'bake/theme/client';

export function startNotes(article) {
  article.addEventListener('click', (event) => {
    const link = event.target.closest('.sidenote-ref a');
    if (link === null || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const note = article.querySelector(`.bk-sidenote[data-sidenote="${link.parentElement.dataset.sidenote}"]`);
    if (note === null) return;
    event.preventDefault();
    const box = note.getBoundingClientRect();
    const card = note.closest('.bt-card[data-overflow]');
    const frame = card?.getBoundingClientRect();
    const clipped = frame !== undefined && (box.top < frame.top || box.bottom > frame.bottom);
    if (clipped) card.focus({ preventScroll: true });
    if (clipped || box.top < 0 || box.bottom > innerHeight) note.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'instant' : 'smooth' });
    flash(note);
  });
}
