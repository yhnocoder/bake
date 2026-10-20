import { fragmentOf } from 'bake/fragments';
import { closeOnEscape, reducedMotion } from 'bake/theme/client';

const SENTENCE_END = /[。！？]|[.!?](?=\s|$)/;
const SKIPPED_TEXT = 'mjx-container, code, .sidenote-ref';
const HIDE_DELAY = 200;
const WARM_TIME = 400;
const EDGE = 12;
export const ENTRY_GAP = 12;

export function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function tocLink(id, className) {
  const link = createElement('a', className);
  link.href = fragmentOf(id);
  return link;
}

export function readOutline(nav) {
  const chapters = [];
  const entries = [];
  for (const item of nav.querySelectorAll('.bk-toc-chapter')) {
    const heading = document.getElementById(item.dataset.target);
    const chapter = {
      id: item.dataset.target,
      number: item.querySelector('.bk-toc-number').textContent,
      title: item.querySelector('.bk-toc-text').textContent,
      heading,
      recap: item.querySelector('.bk-toc-chapter-recap .bk-toc-recap-text')?.innerHTML,
      index: entries.length,
      sections: [],
    };
    entries.push({ id: chapter.id, level: 2, chapter: chapters.length, section: -1, heading });
    for (const row of item.querySelectorAll('.bk-toc-section')) {
      const sectionHeading = document.getElementById(row.dataset.target);
      chapter.sections.push({
        id: row.dataset.target,
        title: row.querySelector('.bk-toc-section-title').textContent,
        heading: sectionHeading,
        recap: row.querySelector('.bk-toc-recap-text')?.innerHTML,
        index: entries.length,
      });
      entries.push({ id: row.dataset.target, level: 3, chapter: chapters.length, section: chapter.sections.length - 1, heading: sectionHeading });
    }
    chapters.push(chapter);
  }
  return { chapters, entries, leads: new Map() };
}

export function outlineKey(outline) {
  return JSON.stringify(outline.chapters.map((chapter) => [chapter.id, chapter.number, chapter.title, chapter.recap, chapter.sections.map((section) => [section.id, section.title, section.recap])]));
}

export function chapterCard(context, chapterIndex, state) {
  const chapter = context.outline.chapters[chapterIndex];
  const current = chapterIndex === state.chapter;
  const card = createElement('div', 'bk-toc-card');
  const head = tocLink(chapter.id, 'bk-toc-card-head');
  head.dataset.index = chapter.index;
  const number = createElement('span', current ? 'bk-toc-card-number is-current' : 'bk-toc-card-number', current ? `${chapter.number} · ${context.labels.reading}` : chapter.number);
  const title = createElement('span', 'bk-toc-card-title');
  title.append(fullTitle(chapter));
  head.append(number, title);
  card.append(head);
  if (chapter.recap !== undefined) card.append(summary('div', 'bk-toc-card-recap bk-toc-card-chapter-recap', chapter.recap));
  else {
    const lead = leadOf(context.outline, chapter.heading);
    if (lead !== null) card.append(summary('p', 'bk-toc-card-lead bk-toc-card-chapter-lead', lead));
  }
  if (chapter.sections.length > 0) {
    const list = createElement('div', 'bk-toc-card-sections');
    for (const section of chapter.sections) {
      const row = tocLink(section.id, 'bk-toc-card-section');
      row.dataset.index = section.index;
      row.classList.toggle('is-read', state.read[section.index]);
      row.classList.toggle('is-current', state.entry === section.index);
      row.append(createElement('span', 'bk-toc-card-section-title', section.title));
      if (section.recap !== undefined) row.append(summary('span', 'bk-toc-card-recap', section.recap));
      else {
        const lead = leadOf(context.outline, section.heading);
        if (lead !== null) row.append(summary('span', 'bk-toc-card-lead', lead));
      }
      list.append(row);
    }
    card.append(list);
  }
  return card;
}

export function createCardHost({ variant, showDelay }) {
  const panel = variant === 'panel';
  const joined = variant === 'tabs';
  const on = panel ? 'is-open' : 'is-on';
  const frame = createElement('div', panel ? 'bk-toc-panel' : joined ? 'bk-toc-index' : `bk-toc-popover is-${variant}`);
  const scroller = joined ? createElement('div', 'bk-toc-index-body') : frame;
  const tab = joined ? createElement('a', 'bk-toc-index-tab') : null;
  if (joined) {
    tab.tabIndex = -1;
    frame.append(tab, scroller);
  }
  const element = panel ? frame : createElement('div', `bk-toc-place is-${variant}`);
  if (!panel) element.append(frame);
  let parts = null;
  let shownChapter = -1;
  let shownKey = '';
  let pointed = null;
  let dismissed = null;
  let showTimer = 0;
  let hideTimer = 0;
  let warmUntil = 0;
  const isShown = () => frame.classList.contains(on);
  const shown = () => (isShown() ? shownChapter : -1);
  const insideParts = (target) => target instanceof Node && parts.columns.some((column) => column.contains(target));

  function render(chapter, keepScroll) {
    const state = parts.context.state();
    const scrollTop = keepScroll ? scroller.scrollTop : 0;
    scroller.replaceChildren(chapterCard(parts.context, chapter, state));
    scroller.scrollTop = scrollTop;
    shownKey = stateKey(state);
    if (!joined) return;
    const { id, number } = parts.context.outline.chapters[chapter];
    tab.href = fragmentOf(id);
    tab.textContent = number;
    tab.classList.toggle('is-current', chapter === Math.max(0, state.chapter));
  }
  function position() {
    if (panel || shownChapter < 0) return;
    const spot = parts.anchor(shownChapter);
    const floor = innerHeight - (joined ? parts.context.reserve : EDGE);
    scroller.style.maxHeight = `${floor - EDGE}px`;
    const top = clamp(spot.top, EDGE, floor - Math.min(scroller.scrollHeight, floor - EDGE));
    element.style.transform = `translate(${spot.left}px, ${top}px)`;
    if (!joined) return;
    tab.style.top = `${spot.tabTop - top}px`;
    tab.style.height = `${spot.tabHeight}px`;
  }
  function mark(reveal) {
    for (const entry of parts.entries) entry.classList.toggle('is-hover', entry === pointed);
    if (variant !== 'ticks') return;
    for (const row of frame.querySelectorAll('[data-index]')) {
      const hovered = row.dataset.index === pointed?.dataset.index;
      row.classList.toggle('is-hover', hovered);
      if (hovered && reveal) keepVisible(frame, row, !reducedMotion.matches);
    }
  }
  function show(chapter) {
    const wasShown = isShown();
    if (!panel && (chapter !== shownChapter || !wasShown)) render(chapter, wasShown && chapter === shownChapter);
    shownChapter = chapter;
    if (wasShown) position();
    else withoutTransition([element], position);
    mark(true);
    frame.classList.add(on);
    if (!wasShown) parts.shown?.();
  }
  function hide() {
    frame.classList.remove(on);
    shownChapter = -1;
    pointed = null;
    mark(false);
  }
  function point(chapter, entry, now = false) {
    if (!now && entry === dismissed) return;
    dismissed = null;
    pointed = entry;
    mark(false);
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    if (now || isShown() || performance.now() < warmUntil) show(chapter);
    else showTimer = setTimeout(() => show(chapter), showDelay);
  }
  function leave() {
    dismissed = null;
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (isShown()) warmUntil = performance.now() + WARM_TIME;
      hide();
    }, HIDE_DELAY);
  }
  function close() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    dismissed = frame.matches(':hover') || parts.columns.some((column) => column.matches(':hover')) ? pointed : null;
    hide();
  }
  function routeKeyboard(groups) {
    const links = () => [...frame.querySelectorAll('.bk-toc-card a[href]')];
    for (const [index, group] of groups.entries()) {
      group.at(-1).addEventListener('keydown', (event) => {
        if (event.key !== 'Tab' || event.shiftKey || shown() !== index) return;
        const first = links()[0];
        if (first === undefined) return;
        event.preventDefault();
        first.focus({ preventScroll: true });
      });
    }
    frame.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab' || shown() < 0) return;
      const all = links();
      const index = shown();
      if (event.shiftKey && event.target === all[0]) {
        event.preventDefault();
        groups[index].at(-1).focus({ preventScroll: true });
      } else if (!event.shiftKey && event.target === all.at(-1) && index + 1 < groups.length) {
        event.preventDefault();
        groups[index + 1][0].focus({ preventScroll: true });
      }
    });
  }

  return {
    frame,
    connect(view, context) {
      const groups = view.chapters;
      parts = { context, anchor: view.anchor, shown: view.shown, columns: view.columns, entries: groups.flat() };
      for (const [chapter, group] of groups.entries()) {
        for (const entry of group) {
          entry.addEventListener('pointerenter', () => point(chapter, entry));
          entry.addEventListener('focus', () => point(chapter, entry, entry.matches(':focus-visible')));
          if (panel) {
            entry.addEventListener('click', (event) => {
              event.preventDefault();
              point(chapter, entry, true);
            });
          }
        }
      }
      for (const column of parts.columns) {
        column.addEventListener('pointerleave', (event) => {
          if (!frame.contains(event.relatedTarget)) leave();
        });
      }
      frame.addEventListener('pointerenter', () => clearTimeout(hideTimer));
      frame.addEventListener('pointerleave', (event) => {
        if (!insideParts(event.relatedTarget)) leave();
      });
      if (variant === 'ticks') {
        frame.addEventListener('pointerover', (event) => {
          const row = event.target.closest('[data-index]');
          if (row === null) return;
          pointed = parts.entries.find((entry) => entry.dataset.index === row.dataset.index) ?? pointed;
          mark(false);
        });
      }
      if (panel) {
        frame.addEventListener('click', (event) => {
          if (event.target.closest('a') !== null) close();
        });
      } else routeKeyboard(groups);
      for (const target of [frame, ...parts.entries]) {
        target.addEventListener('focusout', (event) => {
          if (!frame.contains(event.relatedTarget) && !insideParts(event.relatedTarget)) leave();
        });
      }
      closeOnEscape(frame, () => {
        const wasShown = isShown();
        const index = shown();
        // why: the entry takes the focus while the card is still shown, because its focus listener opens the card when it is closed
        if (!panel && index >= 0 && frame.contains(document.activeElement)) groups[index].at(-1).focus({ preventScroll: true });
        close();
        return wasShown;
      });
      context.host.append(element);
    },
    update(state) {
      if (panel || !isShown() || stateKey(state) === shownKey) return;
      render(shownChapter, true);
      if (joined) position();
      mark(false);
    },
    refresh() {
      if (!panel && isShown()) render(shownChapter, true);
    },
    relayout() {
      if (isShown()) position();
    },
    destroy() {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      element.remove();
    },
  };
}

export function withoutTransition(elements, change) {
  for (const element of elements) element.style.transition = 'none';
  change();
  // why: reading the style applies the change while the transitions are off, so the change does not animate
  for (const element of elements) getComputedStyle(element).transform;
  for (const element of elements) element.style.transition = '';
}

export function keepVisible(box, row, smooth) {
  const boxRect = box.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  let delta = 0;
  if (rowRect.top < boxRect.top + 10) delta = rowRect.top - boxRect.top - 10;
  else if (rowRect.bottom > boxRect.bottom - 10) delta = rowRect.bottom - boxRect.bottom + 10;
  if (delta !== 0) box.scrollTo({ top: box.scrollTop + delta, behavior: smooth ? 'smooth' : 'instant' });
}

export function stateKey(state) {
  return `${state.entry} ${state.read.filter(Boolean).length}`;
}

export function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

export function bottomReserve(host) {
  const probe = createElement('div');
  probe.style.cssText = 'position: fixed; height: var(--ui-reserve)';
  host.append(probe);
  const height = probe.offsetHeight;
  probe.remove();
  return height;
}

function summary(tag, className, html) {
  const element = createElement(tag, className);
  element.append(cleaned(html));
  return element;
}

function fullTitle(chapter) {
  const text = chapter.heading?.querySelector('.bk-heading-text');
  return text === null || text === undefined ? document.createTextNode(chapter.title) : cleaned(text.innerHTML);
}

function leadOf(outline, heading) {
  if (heading === null) return null;
  if (!outline.leads.has(heading)) outline.leads.set(heading, findLead(heading));
  return outline.leads.get(heading);
}

function findLead(heading) {
  for (let node = heading.nextElementSibling; node !== null; node = node.nextElementSibling) {
    if (node.matches('h2, h3')) return null;
    if (node.matches('.bk-block[data-type="paragraph"]')) return firstSentence(node.querySelector('p') ?? node);
  }
  return null;
}

function firstSentence(paragraph) {
  const copy = paragraph.cloneNode(true);
  const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.parentElement.closest(SKIPPED_TEXT) !== null) continue;
    const match = SENTENCE_END.exec(node.data);
    if (match === null) continue;
    const rest = document.createRange();
    rest.setStart(node, match.index + match[0].length);
    rest.setEndAfter(copy.lastChild);
    rest.deleteContents();
    break;
  }
  return copy.innerHTML;
}

function cleaned(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const content = template.content;
  for (const element of content.querySelectorAll('.sidenote-ref, .bk-heading-link')) element.remove();
  for (const element of content.querySelectorAll('mark, a')) element.replaceWith(...element.childNodes);
  for (const element of content.querySelectorAll('[id]')) element.removeAttribute('id');
  return content;
}
