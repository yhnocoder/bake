import { declaresNaturalWidth, labelsFor, naturalWidthProbe, naturalWidths, notesColumnScreen, overflows, requestLayout } from 'bake/theme/client';
import { levelSpan } from '../spans.js';

const placedHeights = new WeakMap();
const resizes = new ResizeObserver((entries) => {
  if (entries.some(({ target, borderBoxSize }) => placedHeights.has(target) && Math.abs(borderBoxSize[0].blockSize - placedHeights.get(target)) > 0.5)) requestLayout({ arrange: true });
});

export function placeCards(article) {
  const grid = article.querySelector('.bt-grid');
  if (grid === null) return;
  const cards = [...grid.querySelectorAll(':scope > .bt-card')];
  if (!notesColumnScreen.matches) {
    unpack(grid, cards);
    return;
  }
  const columns = Number(grid.dataset.columns);
  const style = getComputedStyle(grid);
  const gap = parseFloat(style.columnGap);
  const rowHeight = parseFloat(style.getPropertyValue('--bt-row-height'));
  const column = (grid.clientWidth - gap * (columns - 1)) / columns;
  const spanWidth = (span) => column * span + gap * (span - 1);
  const spans = new Map(cards.map((card) => [card, declaredSpan(card, columns)]));
  setAttribute(grid, 'data-packed', '');
  for (const card of cards) setStyle(card, 'width', `${spanWidth(spans.get(card))}px`);
  const wideSpan = levelSpan('wide', columns);
  for (const card of wideCards(cards.filter((card) => card.dataset.span === 'auto' && spans.get(card) < wideSpan))) {
    spans.set(card, wideSpan);
    setStyle(card, 'width', `${spanWidth(wideSpan)}px`);
  }
  const boxes = cards.map((card) => ({ height: card.getBoundingClientRect().height, scrollHeight: card.scrollHeight, clientHeight: card.clientHeight, end: card.scrollTop + card.clientHeight >= card.scrollHeight - 1 }));
  const tops = Array(columns).fill(0);
  const hint = devHint();
  const borders = cards.length === 0 ? 0 : verticalBorders(cards[0]);
  cards.forEach((card, index) => {
    const span = spans.get(card);
    const { height, scrollHeight, clientHeight, end } = boxes[index];
    let start = 0;
    let top = Infinity;
    for (let first = 0; first + span <= columns; first += 1) {
      const level = Math.max(...tops.slice(first, first + span));
      if (level < top - 0.5) {
        top = level;
        start = first;
      }
    }
    for (let next = start; next < start + span; next += 1) tops[next] = top + height + gap;
    placedHeights.set(card, height);
    resizes.observe(card);
    setStyle(card, 'transform', `translate(${start * (column + gap)}px, ${top}px)`);
    const overflow = card.dataset.rows === undefined ? 0 : scrollHeight - clientHeight;
    setAttribute(card, 'data-overflow', overflow > 1 ? '' : null);
    setAttribute(card, 'data-end', overflow > 1 && end ? '' : null);
    setAttribute(card, 'tabindex', overflow > 1 ? '0' : null);
    setAttribute(card, 'data-hint', hint !== null && overflow > 1 ? hint(Math.ceil(overflow), Math.ceil((scrollHeight + borders + gap) / (rowHeight + gap))) : null);
  });
  setStyle(grid, 'height', `${Math.max(0, ...tops) - gap}px`);
}

function unpack(grid, cards) {
  setAttribute(grid, 'data-packed', null);
  setStyle(grid, 'height', '');
  for (const card of cards) {
    resizes.unobserve(card);
    placedHeights.delete(card);
    setStyle(card, 'width', '');
    setStyle(card, 'transform', '');
    for (const name of ['data-overflow', 'data-end', 'data-hint', 'data-active', 'tabindex']) setAttribute(card, name, null);
  }
}

function declaredSpan(card, columns) {
  return Math.min(Number(card.style.getPropertyValue('--bt-span')), columns);
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

function verticalBorders(element) {
  const style = getComputedStyle(element);
  return parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
}

function devHint() {
  if (document.querySelector('script[data-bake-dev]') === null) return null;
  return labelsFor(document.documentElement.lang).cardOverflow;
}

function setStyle(element, name, value) {
  if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
}

function setAttribute(element, name, value) {
  if (value === null) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
  } else if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}
