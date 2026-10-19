import { labelsFor } from '../labels.js';
import { LAYOUT_EVENT, expand, flash, oncePerFrame, reducedMotion, stopAnimations } from './motion.js';

const wideScreen = matchMedia('(min-width: 1000px)');
const NOTE_GAP = 12;
const TINTED_CONTAINER = 'p, li, td, th, figcaption, blockquote, summary, .bk-block';

export function startNotes(article) {
  const originals = [...article.querySelectorAll('.bk-sidenote')];
  if (originals.length === 0) return;
  const labels = labelsFor(document.documentElement.lang);
  const layer = document.createElement('div');
  layer.className = 'bk-notes-layer';
  const placed = originals.map((original) => {
    const note = original.cloneNode(true);
    note.removeAttribute('id');
    note.setAttribute('aria-label', labels.sidenote(original.dataset.sidenote));
    layer.append(note);
    return { note, number: original.dataset.sidenote };
  });
  article.append(layer);

  const layout = oncePerFrame(() => placeNotes(article, layer, placed));
  layout();
  new ResizeObserver(layout).observe(article);
  addEventListener('resize', layout);
  document.addEventListener(LAYOUT_EVENT, layout);
  document.fonts.ready.then(layout);
  document.fonts.addEventListener('loadingdone', layout);
  wideScreen.addEventListener('change', layout);

  let active = null;
  const activate = (number) => {
    if (number === active) return;
    if (active !== null) highlight(article, layer, active, false);
    active = number;
    if (active !== null) highlight(article, layer, active, true);
  };
  article.addEventListener('pointerover', (event) => {
    const target = event.target.closest('.sidenote-ref, .bk-notes-layer .bk-sidenote');
    if (target !== null) activate(target.dataset.sidenote);
  });
  article.addEventListener('pointerout', (event) => {
    const target = event.target.closest('.sidenote-ref, .bk-notes-layer .bk-sidenote');
    if (target !== null && !target.contains(event.relatedTarget)) activate(null);
  });
  article.addEventListener('click', (event) => {
    const link = event.target.closest('.sidenote-ref a');
    if (link === null || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    const number = link.parentElement.dataset.sidenote;
    if (wideScreen.matches) {
      const note = layer.querySelector(`.bk-sidenote[data-sidenote="${number}"]`);
      if (note !== null) flash(note);
      return;
    }
    const inline = article.querySelector(`.bk-sidenote[data-sidenote="${number}"]:not(.bk-notes-layer *)`);
    if (inline !== null) toggleInline(article, inline);
  });
}

function placeNotes(article, layer, placed) {
  if (!wideScreen.matches) return;
  const column = layer.getBoundingClientRect();
  const blocked = obstacles(article, layer, column);
  let floor = -Infinity;
  for (const { note, number } of placed) {
    const ref = visibleReference(article, number);
    note.hidden = ref === null;
    if (ref === null) continue;
    const line = lineOf(ref);
    const lineHeight = parseFloat(getComputedStyle(note).lineHeight) || line.height;
    const height = note.offsetHeight;
    let top = Math.round(Math.max(line.top - column.top + (line.height - lineHeight) / 2, floor));
    for (let moved = true; moved; ) {
      moved = false;
      for (const block of blocked) {
        if (top < block.bottom && top + height > block.top) {
          top = Math.round(block.bottom + NOTE_GAP);
          moved = true;
        }
      }
    }
    note.style.top = `${top}px`;
    floor = top + height + NOTE_GAP;
  }
}

function obstacles(article, layer, column) {
  const right = column.left + column.width;
  const blocks = [];
  for (const block of article.querySelectorAll('.bk-block')) {
    if (layer.contains(block)) continue;
    const box = block.getBoundingClientRect();
    if (box.height === 0 || box.right <= column.left || box.left >= right) continue;
    blocks.push({ top: box.top - column.top, bottom: box.bottom - column.top });
  }
  return blocks;
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

function highlight(article, layer, number, on) {
  for (const element of article.querySelectorAll(`.sidenote-ref[data-sidenote="${number}"]`)) element.classList.toggle('is-active', on);
  layer.querySelector(`.bk-sidenote[data-sidenote="${number}"]`)?.classList.toggle('is-active', on);
  const container = visibleReference(article, number)?.parentElement.closest(TINTED_CONTAINER);
  if (container === null || container === undefined) return;
  if (!container.classList.contains('bk-tintable')) {
    container.classList.add('bk-tintable');
    container.getBoundingClientRect();
  }
  container.classList.toggle('bk-tinted', on);
}

function toggleInline(article, note) {
  const opening = !note.classList.contains('is-open');
  for (const ref of article.querySelectorAll(`.sidenote-ref[data-sidenote="${note.dataset.sidenote}"] a`)) ref.setAttribute('aria-expanded', String(opening));
  stopAnimations(note);
  if (opening) {
    note.classList.add('is-open');
    if (!reducedMotion.matches) expand(note, true).then((done) => done && stopAnimations(note));
    return;
  }
  if (reducedMotion.matches) {
    note.classList.remove('is-open');
    return;
  }
  expand(note, false, { duration: 160 }).then((done) => {
    if (!done) return;
    note.classList.remove('is-open');
    stopAnimations(note);
  });
}
