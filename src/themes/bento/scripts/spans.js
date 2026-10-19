import { CONTENT_EVENT, layoutChanged, oncePerFrame } from '../../essay/scripts/motion.js';
import { naturalWidth, overflows } from '../../essay/scripts/widths.js';

const WIDE_SPAN = 2;

export function startSpans(article) {
  let width = 0;
  const layout = oncePerFrame(() => {
    const grid = article.querySelector('.bt-grid');
    if (grid === null) return;
    placeCards(grid);
    layoutChanged();
  });
  layout();
  new ResizeObserver(() => {
    if (article.clientWidth === width) return;
    width = article.clientWidth;
    layout();
  }).observe(article);
  document.fonts.ready.then(layout);
  document.addEventListener(CONTENT_EVENT, layout);
}

function placeCards(grid) {
  const cards = [...grid.querySelectorAll(':scope > .bt-card')];
  for (const card of cards) card.style.removeProperty('grid-column');
  const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  for (const card of cards) card.style.gridColumn = `span ${declaredSpan(card, columns)}`;
  const spans = cards.map((card) => {
    const declared = declaredSpan(card, columns);
    return card.dataset.span === 'auto' && declared < columns && needsWide(card) ? Math.min(WIDE_SPAN, columns) : declared;
  });
  fillRows(spans, columns);
  cards.forEach((card, index) => {
    card.style.gridColumn = `span ${spans[index]}`;
  });
}

function declaredSpan(card, columns) {
  if (card.dataset.span === 'page') return columns;
  return Math.min(card.dataset.span === 'auto' ? 1 : Number(card.dataset.span), columns);
}

function needsWide(card) {
  const room = card.clientWidth - horizontalPadding(card);
  return [...card.querySelectorAll(':scope > .bk-block[data-width="auto"]')].some((block) => {
    const declared = getComputedStyle(block).getPropertyValue('--natural-width').trim() !== '';
    return declared ? naturalWidth(block) > room + 0.5 : overflows(block);
  });
}

function horizontalPadding(element) {
  const style = getComputedStyle(element);
  return parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
}

function fillRows(spans, columns) {
  let used = 0;
  spans.forEach((span, index) => {
    if (used > 0 && used + span > columns) {
      spans[index - 1] += columns - used;
      used = 0;
    }
    used = (used + span) % columns;
  });
  if (used > 0) spans[spans.length - 1] += columns - used;
}
