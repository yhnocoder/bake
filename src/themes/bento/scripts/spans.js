import { declaresNaturalWidth, naturalWidthProbe, naturalWidths, overflows } from 'bake/theme/client';

const WIDE_SPAN = 2;

export function placeCards(article) {
  const grid = article.querySelector('.bt-grid');
  if (grid === null) return;
  const cards = [...grid.querySelectorAll(':scope > .bt-card')];
  for (const card of cards) card.style.removeProperty('grid-column');
  const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  for (const card of cards) card.style.gridColumn = `span ${declaredSpan(card, columns)}`;
  const candidates = cards.filter((card) => card.dataset.span === 'auto' && declaredSpan(card, columns) < columns);
  const wide = wideCards(candidates);
  cards.forEach((card) => {
    card.style.gridColumn = `span ${wide.has(card) ? Math.min(WIDE_SPAN, columns) : declaredSpan(card, columns)}`;
  });
}

function declaredSpan(card, columns) {
  if (card.dataset.span === 'page') return columns;
  return Math.min(card.dataset.span === 'auto' ? 1 : Number(card.dataset.span), columns);
}

function wideCards(cards) {
  const rooms = new Map(cards.map((card) => [card, card.clientWidth - horizontalPadding(card)]));
  const blocks = cards.flatMap((card) => [...card.querySelectorAll(':scope > .bk-block[data-width="auto"]')].map((block) => ({ card, block })));
  const declared = [];
  const overflowing = [];
  for (const entry of blocks) {
    if (declaresNaturalWidth(entry.block)) declared.push(entry);
    else if (overflows(entry.block)) overflowing.push(entry);
  }
  const natural = naturalWidths(declared.map(({ block }) => naturalWidthProbe(block)));
  const wide = declared.filter(({ card }, index) => natural[index] > rooms.get(card) + 0.5);
  return new Set([...wide, ...overflowing].map(({ card }) => card));
}

function horizontalPadding(element) {
  const style = getComputedStyle(element);
  return parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
}
