import { naturalWidth, overflows } from 'bake/theme/client';

const WIDE_SPAN = 2;

export function placeCards(article) {
  const grid = article.querySelector('.bt-grid');
  if (grid === null) return;
  const cards = [...grid.querySelectorAll(':scope > .bt-card')];
  for (const card of cards) card.style.removeProperty('grid-column');
  const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  for (const card of cards) card.style.gridColumn = `span ${declaredSpan(card, columns)}`;
  const spans = cards.map((card) => {
    const declared = declaredSpan(card, columns);
    return card.dataset.span === 'auto' && declared < columns && needsWide(card) ? Math.min(WIDE_SPAN, columns) : declared;
  });
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
