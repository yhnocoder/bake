import { currentLayout } from 'bake/theme/client';
import { ENTRY_GAP, clamp, createElement, tocLink } from './toc-card.js';

export const TICKS_CARD = { variant: 'ticks', showDelay: 70 };
const CHAPTER_GAP = 6;
const PITCH = [6, 10];
const RAIL_LEFT = 10;
const COLUMN_WIDTH = 46;
const TEXT_DISTANCE = 78;
const CARD_GAP = 8;
const CARD_RISE = 22;

export function ticksColumn({ outline, labels, article, reserve }, rail = false) {
  const element = createElement('nav', rail ? 'bk-toc-ticks is-rail' : 'bk-toc-ticks');
  element.setAttribute('aria-label', labels.toc);
  const rows = outline.entries.map((entry, index) => {
    const chapter = outline.chapters[entry.chapter];
    const row = tocLink(entry.id, entry.level === 2 ? 'bk-toc-tick is-chapter' : 'bk-toc-tick');
    row.dataset.index = index;
    row.setAttribute('aria-label', entry.level === 2 ? `${chapter.number} ${chapter.title}` : chapter.sections[entry.section].title);
    row.append(createElement('span', 'bk-toc-tick-line'));
    element.append(row);
    return row;
  });
  let left = RAIL_LEFT;
  let drawn = null;
  const relayout = () => {
    const room = innerHeight - 2 * (reserve + ENTRY_GAP);
    const fitting = (room - (outline.chapters.length - 1) * CHAPTER_GAP) / rows.length;
    const pitch = Math.min(clamp(fitting, ...PITCH), Math.max(1, fitting));
    element.style.setProperty('--pitch', `${pitch}px`);
    element.style.setProperty('--chapter-gap', `${pitch < 8 ? 3 : CHAPTER_GAP}px`);
    if (rail) return;
    left = Math.max(RAIL_LEFT, currentLayout(article).article.left - scrollX - TEXT_DISTANCE);
    element.style.left = `${left}px`;
  };
  relayout();
  return {
    element,
    chapters: outline.chapters.map((chapter, index) => rows.filter((row, rowIndex) => outline.entries[rowIndex].chapter === index)),
    relayout,
    anchor: (chapter) => ({ left: left + COLUMN_WIDTH + CARD_GAP, top: rows[outline.chapters[chapter].index].getBoundingClientRect().top - CARD_RISE }),
    update(state) {
      const key = `${state.entry} ${state.read.join()}`;
      if (key === drawn) return;
      drawn = key;
      rows.forEach((row, index) => {
        row.classList.toggle('is-current', index === state.entry);
        row.classList.toggle('is-read', state.read[index] || index < state.entry);
      });
    },
  };
}

export function ticksView(view) {
  const ticks = ticksColumn(view);
  view.host.append(ticks.element);
  return {
    columns: [ticks.element],
    chapters: ticks.chapters,
    anchor: ticks.anchor,
    update: ticks.update,
    relayout: ticks.relayout,
    destroy() {
      ticks.element.remove();
    },
  };
}
