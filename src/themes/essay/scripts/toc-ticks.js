import { reducedMotion } from './motion.js';
import { cardKeyboard, chapterCard, clamp, el, floorFor, hoverIntent, keepVisible, stateKey, tocLink } from './toc-card.js';

const SHOW_DELAY = 70;
const MARGIN = 140;
const CHAPTER_GAP = 6;
const PITCH = [6, 10];

export function ticksColumn(ctx, { rail = false, hover, leave, click } = {}) {
  const { outline } = ctx;
  const element = el('nav', rail ? 'bk-ticks is-rail' : 'bk-ticks');
  element.setAttribute('aria-label', ctx.labels.toc);
  const rows = outline.entries.map((entry, index) => {
    const chapter = outline.chapters[entry.chapter];
    const row = tocLink(entry.id, entry.level === 2 ? 'bk-tick is-chapter' : 'bk-tick');
    row.setAttribute('aria-label', entry.level === 2 ? `${chapter.number} ${chapter.title}` : chapter.sections[entry.section].title);
    row.append(el('span', 'bk-tick-line'));
    row.addEventListener('pointerenter', () => hover?.(index));
    row.addEventListener('focus', () => hover?.(index, row.matches(':focus-visible')));
    if (click !== undefined) {
      row.addEventListener('click', (event) => {
        event.preventDefault();
        click(index);
      });
    }
    element.append(row);
    return row;
  });
  element.addEventListener('pointerleave', (event) => leave?.(event));
  const relayout = () => {
    const room = innerHeight - MARGIN;
    const chapters = outline.chapters.length;
    const fitting = (room - (chapters - 1) * CHAPTER_GAP) / rows.length;
    const pitch = Math.min(clamp(fitting, ...PITCH), Math.max(1, fitting));
    element.style.setProperty('--pitch', `${pitch}px`);
    element.style.setProperty('--chapter-gap', `${pitch < 8 ? 3 : CHAPTER_GAP}px`);
    if (!rail) element.style.left = `${Math.max(10, ctx.article.getBoundingClientRect().left - 78)}px`;
  };
  relayout();
  return {
    element,
    rows,
    relayout,
    update(state) {
      rows.forEach((row, index) => {
        row.classList.toggle('is-current', index === state.entry);
        row.classList.toggle('is-read', state.read[index] || index < state.entry);
      });
    },
    hover(index) {
      rows.forEach((row, rowIndex) => row.classList.toggle('is-hover', rowIndex === index));
    },
  };
}

export function ticksView(ctx) {
  const card = el('div', 'bk-popover is-ticks');
  const intent = hoverIntent(SHOW_DELAY);
  let shownChapter = -1;
  let shownState = '';
  let pointed = -1;
  const ticks = ticksColumn(ctx, {
    hover: (index, now) => point(index, true, now),
    leave(event) {
      if (!card.contains(event.relatedTarget)) leave();
    },
  });
  card.addEventListener('pointerenter', () => intent.stay());
  card.addEventListener('pointerleave', (event) => {
    if (!ticks.element.contains(event.relatedTarget)) leave();
  });
  card.addEventListener('pointerover', (event) => {
    const row = event.target.closest('[data-index]');
    if (row !== null) point(Number(row.dataset.index), false);
  });
  ctx.host.append(ticks.element, card);
  cardKeyboard({
    groups: ctx.outline.chapters.map((chapter, chapterIndex) => ticks.rows.filter((row, index) => ctx.outline.entries[index].chapter === chapterIndex)),
    card,
    shown: () => (card.classList.contains('is-on') ? shownChapter : -1),
    leave: () => leave(),
  });

  function render(chapterIndex) {
    const scrollTop = chapterIndex === shownChapter ? card.scrollTop : 0;
    card.replaceChildren(chapterCard(ctx, chapterIndex, ctx.state()));
    card.scrollTop = scrollTop;
    shownChapter = chapterIndex;
    shownState = stateKey(ctx.state());
  }
  function place() {
    const column = ticks.element.getBoundingClientRect();
    const first = ticks.rows[ctx.outline.chapters[shownChapter].index].getBoundingClientRect();
    const left = column.right + 8;
    const floor = floorFor(left);
    card.style.maxHeight = `${floor - 12}px`;
    const height = Math.min(card.scrollHeight, floor - 12);
    card.style.left = `${left}px`;
    card.style.top = `${clamp(first.top - 22, 12, floor - height)}px`;
  }
  function mark(reveal) {
    for (const node of card.querySelectorAll('[data-index]')) {
      const on = Number(node.dataset.index) === pointed;
      node.classList.toggle('is-hover', on);
      if (on && reveal) keepVisible(card, node, !reducedMotion.matches);
    }
  }
  function point(index, fromTicks, now = false) {
    pointed = index;
    ticks.hover(index);
    intent.enter(() => {
      const wasOn = card.classList.contains('is-on');
      const chapterIndex = ctx.outline.entries[index].chapter;
      if (chapterIndex !== shownChapter || !wasOn) render(chapterIndex);
      card.classList.toggle('is-snap', !wasOn);
      place();
      mark(fromTicks);
      card.getBoundingClientRect();
      card.classList.remove('is-snap');
      card.classList.add('is-on');
    }, now);
  }
  function leave() {
    intent.leave(() => {
      card.classList.remove('is-on');
      shownChapter = -1;
      pointed = -1;
      ticks.hover(-1);
    });
  }
  return {
    columns: [ticks.element],
    update(state) {
      ticks.update(state);
      if (card.classList.contains('is-on') && shownChapter >= 0 && stateKey(state) !== shownState) {
        render(shownChapter);
        mark(false);
      }
    },
    relayout: ticks.relayout,
    destroy() {
      intent.stop();
      ticks.element.remove();
      card.remove();
    },
  };
}
