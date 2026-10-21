import { declaresNaturalWidth, naturalWidth, notesColumnScreen, overflows, requestLayout } from 'bake/theme/client';
import { levelSpan } from '../spans.js';

const CARD_OVERFLOW = {
  zh: (pixels, rows) => `内容超出卡片 ${pixels} 像素，rows 至少写 ${rows}`,
  en: (pixels, rows) => `Content is ${pixels} px taller than the card; set rows to at least ${rows}`,
};

const placedHeights = new WeakMap();
const resizes = new ResizeObserver((entries) => {
  if (entries.some(({ target, borderBoxSize }) => placedHeights.has(target) && Math.abs(borderBoxSize[0].blockSize - placedHeights.get(target)) > 0.5)) requestLayout({ arrange: true });
});

export function placeCards(article) {
  const grid = article.querySelector('.bt-grid');
  if (grid === null) return;
  const cards = [...grid.querySelectorAll(':scope > .bt-card')];
  const columns = Number(grid.dataset.columns);
  if (!notesColumnScreen.matches) {
    unpack(grid, cards);
    fitColumns(grid, cards, columns);
    return;
  }
  setStyle(grid, '--bt-cols', '');
  for (const card of cards) setStyle(card, '--bt-narrow-span', '');
  const style = getComputedStyle(grid);
  const gap = parseFloat(style.columnGap);
  const rowHeight = parseFloat(style.getPropertyValue('--bt-row-height'));
  const column = (grid.clientWidth - gap * (columns - 1)) / columns;
  const spanWidth = (span) => column * span + gap * (span - 1);
  const spans = new Map(cards.map((card) => [card, declaredSpan(card, columns)]));
  setAttribute(grid, 'data-packed', '');
  for (const card of cards) setStyle(card, '--bt-width', `${spanWidth(spans.get(card))}px`);
  const wideSpan = levelSpan('wide', columns);
  for (const card of wideCards(cards.filter((card) => card.dataset.span === 'auto' && spans.get(card) < wideSpan))) {
    spans.set(card, wideSpan);
    setStyle(card, '--bt-width', `${spanWidth(wideSpan)}px`);
  }
  const boxes = new Map(cards.map((card) => [card, { height: card.getBoundingClientRect().height, scrollHeight: card.scrollHeight, clientHeight: card.clientHeight, end: card.scrollTop + card.clientHeight >= card.scrollHeight - 1 }]));
  const tops = Array(columns).fill(0);
  const placed = [];
  const hint = devHint();
  const borders = cards.length === 0 ? 0 : verticalBorders(cards[0]);
  const place = (card, start, top) => {
    const span = spans.get(card);
    const { height, scrollHeight, clientHeight, end } = boxes.get(card);
    placed.push({ start, end: start + span, top, bottom: top + height });
    for (let next = start; next < start + span; next += 1) tops[next] = Math.max(tops[next], top + height + gap);
    placedHeights.set(card, height);
    resizes.observe(card);
    setStyle(card, '--bt-x', `${start * (column + gap)}px`);
    setStyle(card, '--bt-y', `${top}px`);
    const overflow = card.dataset.rows === undefined ? 0 : scrollHeight - clientHeight;
    setAttribute(card, 'data-overflow', overflow > 1 ? '' : null);
    setAttribute(card, 'data-end', overflow > 1 && end ? '' : null);
    setAttribute(card, 'tabindex', overflow > 1 ? '0' : null);
    setAttribute(card, 'data-hint', hint !== null && overflow > 1 ? hint(Math.ceil(overflow), Math.ceil((scrollHeight + borders + gap) / (rowHeight + gap))) : null);
  };
  const isSection = (card) => card.dataset.themeBlock === undefined;
  for (const card of cards.filter(isSection)) {
    const span = spans.get(card);
    let start = 0;
    let top = Infinity;
    for (let first = 0; first + span <= columns; first += 1) {
      const level = Math.max(...tops.slice(first, first + span));
      if (level < top - 0.5) {
        top = level;
        start = first;
      }
    }
    place(card, start, top);
  }
  for (const card of cards.filter((card) => !isSection(card))) {
    const { start, top } = highestFit(placed, spans.get(card), boxes.get(card).height, columns, gap);
    place(card, start, top);
  }
  setStyle(grid, '--bt-height', `${Math.max(0, ...tops) - gap}px`);
}

function highestFit(placed, span, height, columns, gap) {
  const levels = [0, ...placed.map((box) => box.bottom + gap)].sort((a, b) => a - b);
  for (const top of levels) {
    for (let start = 0; start + span <= columns; start += 1) {
      const free = placed.every((box) => box.end <= start || box.start >= start + span || top >= box.bottom + gap - 0.5 || top + height + gap <= box.top + 0.5);
      if (free) return { start, top };
    }
  }
}

export function releaseCards() {
  resizes.disconnect();
}

function unpack(grid, cards) {
  setAttribute(grid, 'data-packed', null);
  setStyle(grid, '--bt-height', '');
  for (const card of cards) {
    resizes.unobserve(card);
    placedHeights.delete(card);
    for (const name of ['--bt-width', '--bt-x', '--bt-y']) setStyle(card, name, '');
    for (const name of ['data-overflow', 'data-end', 'data-hint', 'data-active', 'tabindex']) setAttribute(card, name, null);
  }
}

function fitColumns(grid, cards, columns) {
  const style = getComputedStyle(grid);
  const gap = parseFloat(style.columnGap);
  const unit = parseFloat(style.getPropertyValue('--bt-unit'));
  const count = Math.max(1, Math.min(columns, Math.floor((grid.clientWidth + gap) / (unit + gap))));
  setStyle(grid, '--bt-cols', String(count));
  for (const card of cards) {
    const span = declaredSpan(card, columns);
    setStyle(card, '--bt-narrow-span', String(span <= count / 2 ? span : count));
  }
}

function declaredSpan(card, columns) {
  return Math.min(Number(card.style.getPropertyValue('--bt-span')), columns);
}

function wideCards(cards) {
  const rooms = new Map(cards.map((card) => [card, card.clientWidth - horizontalPadding(card)]));
  const reaches = (card, block) => (declaresNaturalWidth(block) ? naturalWidth(block) > rooms.get(card) + 0.5 : overflows(block));
  return new Set(cards.filter((card) => [...card.querySelectorAll(':scope > .bk-block[data-width="auto"]')].some((block) => reaches(card, block))));
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
  return document.documentElement.lang.toLowerCase().startsWith('zh') ? CARD_OVERFLOW.zh : CARD_OVERFLOW.en;
}

function setStyle(element, name, value) {
  if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
}

function setAttribute(element, name, value) {
  if (value === null) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
  } else if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}
