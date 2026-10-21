import { EASING, LAYOUT_EVENT, flash, labelsFor, notesColumnScreen, reducedMotion } from 'bake/theme/client';

const NOTE_GAP = 12;
const TINTED_CONTAINER = 'p, li, td, th, h2, h3, h4, h5, h6, figcaption, blockquote, .bk-block';
const OPEN_DURATION = 200;
const CLOSE_DURATION = 140;
const SHOWN = { opacity: 1, transform: 'none' };
const HIDDEN = { opacity: 0, transform: 'translateY(-4px)' };
const running = new WeakMap();
const closing = new WeakSet();

export function startNotes(article) {
  const labels = labelsFor(document.documentElement.lang);
  const originals = [...article.querySelectorAll('.bk-sidenote')];
  const layer = document.createElement('div');
  layer.className = 'bk-notes-layer';
  layer.dataset.ui = '';
  const placed = originals.map((original) => {
    const note = original.cloneNode(true);
    for (const element of [note, ...note.querySelectorAll('[id]')]) element.removeAttribute('id');
    note.setAttribute('aria-label', labels.sidenote(original.dataset.sidenote));
    layer.append(note);
    return { note, number: original.dataset.sidenote };
  });
  if (originals.length > 0) article.append(layer);
  const place = (event) => {
    if (originals.length > 0) placeNotes(article, layer, placed, event.detail);
  };
  const click = (event) => {
    const link = event.target.closest('.sidenote-ref a');
    if (link === null || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    const number = link.parentElement.dataset.sidenote;
    if (notesColumnScreen.matches) {
      const note = layer.querySelector(`.bk-sidenote[data-sidenote="${number}"]`);
      if (note !== null) flash(note);
      return;
    }
    const inline = article.querySelector(`.bk-sidenote[data-sidenote="${number}"]:not(.bk-notes-layer *)`);
    if (inline !== null) toggleInline(article, inline);
  };
  document.addEventListener(LAYOUT_EVENT, place);
  article.addEventListener('click', click);
  return () => {
    document.removeEventListener(LAYOUT_EVENT, place);
    article.removeEventListener('click', click);
    layer.remove();
  };
}

function placeNotes(article, layer, placed, measured) {
  if (!notesColumnScreen.matches) return;
  const refs = placed.map(({ number }) => visibleReference(article, number));
  placed.forEach(({ note }, index) => {
    note.hidden = refs[index] === null;
  });
  const box = layer.getBoundingClientRect();
  const column = { top: box.top + scrollY, left: box.left + scrollX, right: box.right + scrollX };
  const blocked = measured.blocks.filter((block) => block.height > 0 && block.right > column.left && block.left < column.right).map((block) => ({ top: block.top - column.top, bottom: block.bottom - column.top }));
  const reads = placed.map(({ note }, index) => {
    if (refs[index] === null) return null;
    const line = lineOf(refs[index]);
    return { top: line.top + scrollY - column.top, height: line.height, lineHeight: parseFloat(getComputedStyle(note).lineHeight) || line.height, noteHeight: note.offsetHeight };
  });
  let floor = -Infinity;
  placed.forEach(({ note }, index) => {
    const read = reads[index];
    if (read === null) return;
    let top = Math.round(Math.max(read.top + (read.height - read.lineHeight) / 2, floor));
    for (let moved = true; moved; ) {
      moved = false;
      for (const block of blocked) {
        if (top < block.bottom && top + read.noteHeight > block.top) {
          top = Math.round(block.bottom + NOTE_GAP);
          moved = true;
        }
      }
    }
    note.style.top = `${top}px`;
    floor = top + read.noteHeight + NOTE_GAP;
  });
}

function visibleReference(article, number) {
  for (const ref of article.querySelectorAll(`.sidenote-ref[data-sidenote="${number}"]`)) {
    if (ref.checkVisibility() && ref.getClientRects().length > 0) return ref;
  }
  return null;
}

function lineOf(ref) {
  const box = ref.getBoundingClientRect();
  const before = ref.previousSibling;
  const after = ref.nextSibling;
  const candidates = [
    before?.nodeType === Node.TEXT_NODE && before.length > 0 ? [before, before.length] : null,
    after?.nodeType === Node.TEXT_NODE && after.length > 0 ? [after, 0] : null,
  ];
  for (const candidate of candidates) {
    if (candidate === null) continue;
    const range = document.createRange();
    range.setStart(...candidate);
    const caret = range.getBoundingClientRect();
    if (caret.height > 0 && caret.top < box.bottom && caret.bottom > box.top) return { top: caret.top, height: caret.height };
  }
  return { top: box.top, height: box.height };
}

export function tintParagraph(article, number, on) {
  const container = visibleReference(article, number)?.parentElement.closest(TINTED_CONTAINER);
  if (container === null || container === undefined) return;
  if (!container.classList.contains('bk-tintable')) {
    container.classList.add('bk-tintable');
    container.getBoundingClientRect();
  }
  container.classList.toggle('bk-tinted', on);
}

function toggleInline(article, note) {
  const opening = !note.classList.contains('is-open') || closing.has(note);
  for (const ref of article.querySelectorAll(`.sidenote-ref[data-sidenote="${note.dataset.sidenote}"] a`)) ref.setAttribute('aria-expanded', String(opening));
  const from = note.classList.contains('is-open') ? { opacity: Number(getComputedStyle(note).opacity), transform: getComputedStyle(note).transform } : HIDDEN;
  running.get(note)?.cancel();
  closing.delete(note);
  if (opening) {
    note.classList.add('is-open');
    if (!reducedMotion.matches) running.set(note, note.animate([from, SHOWN], { duration: OPEN_DURATION, easing: EASING }));
    return;
  }
  if (reducedMotion.matches) {
    note.classList.remove('is-open');
    return;
  }
  closing.add(note);
  const animation = note.animate([from, HIDDEN], { duration: CLOSE_DURATION, easing: EASING, fill: 'forwards' });
  running.set(note, animation);
  animation.finished.then(
    () => {
      closing.delete(note);
      note.classList.remove('is-open');
      animation.cancel();
    },
    () => {},
  );
}
