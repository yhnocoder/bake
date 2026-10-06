const gap = 12;
const wideWindow = '(width >= 1100px)';
const paragraphSelector = 'p, li, h1, h2, h3, h4, h5, h6, table, figcaption';

function anchorOf(article, note) {
  if (!note.classList.contains('unnumbered')) return article.querySelector(`#sn-ref-${note.id.slice('sn-'.length)}`);
  let sibling = note.previousElementSibling;
  while (sibling?.classList.contains('sidenote')) sibling = sibling.previousElementSibling;
  return sibling;
}

export function alignSidenotes(article) {
  if (!matchMedia(wideWindow).matches) return;
  const placements = [];
  for (const note of article.querySelectorAll('.sidenote')) {
    const anchor = anchorOf(article, note);
    if (!anchor || !note.offsetParent || !note.checkVisibility()) continue;
    const parent = note.offsetParent.getBoundingClientRect();
    placements.push({
      note,
      anchorTop: anchor.getBoundingClientRect().top,
      parentTop: parent.top + note.offsetParent.clientTop,
      height: note.offsetHeight,
    });
  }
  let bottom = -Infinity;
  for (const placement of placements) {
    placement.top = Math.max(placement.anchorTop, bottom + gap);
    bottom = placement.top + placement.height;
  }
  for (const { note, top, parentTop } of placements) note.style.top = `${top - parentTop}px`;
}

function annotatedRange(article, number) {
  const spans = article.querySelectorAll(`.sidenote-span[data-sidenote="${number}"]`);
  const range = new Range();
  if (spans.length > 0) {
    const last = spans[spans.length - 1];
    range.setStart(spans[0], 0);
    range.setEnd(last, last.childNodes.length);
    return range;
  }
  const paragraph = article.querySelector(`#sn-ref-${number}`)?.closest(paragraphSelector);
  if (!paragraph) return null;
  range.selectNodeContents(paragraph);
  return range;
}

export function watchSidenotes(article) {
  const align = () => alignSidenotes(article);
  new ResizeObserver(align).observe(article);
  document.fonts.ready.then(align);
  document.addEventListener('toggle', align, true);
  window.addEventListener('bake:page-updated', align);

  let highlighted = null;
  let active = null;
  const show = (target) => {
    const note = target?.closest('.sidenote:not(.unnumbered)') ?? null;
    const ref = target?.closest('.sidenote-ref') ?? null;
    const activeNote = ref ? article.querySelector(`#sn-${ref.id.slice('sn-ref-'.length)}`) : null;
    if (activeNote !== active) {
      active?.classList.remove('active');
      activeNote?.classList.add('active');
      active = activeNote;
    }
    if (note === highlighted || !('highlights' in CSS)) return;
    highlighted = note;
    const range = note ? annotatedRange(article, note.id.slice('sn-'.length)) : null;
    if (range) CSS.highlights.set('sidenote', new Highlight(range));
    else CSS.highlights.delete('sidenote');
  };
  article.addEventListener('mouseover', (event) => show(event.target));
  article.addEventListener('mouseleave', () => show(null));
}

