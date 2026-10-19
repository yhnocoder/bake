const SENTENCE_END = /[。！？]|[.!?](?=\s|$)/;
const SKIPPED_TEXT = 'mjx-container, code, .sidenote-ref';
const HIDE_DELAY = 200;
const WARM_TIME = 400;

export function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function tocLink(id, className) {
  const link = el('a', className);
  link.href = `#${encodeURIComponent(id)}`;
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
  return { chapters, entries };
}

export function chapterCard(ctx, chapterIndex, state) {
  const chapter = ctx.outline.chapters[chapterIndex];
  const current = chapterIndex === state.chapter;
  const card = el('div', 'bk-card');
  const head = tocLink(chapter.id, 'bk-card-head');
  head.dataset.index = chapter.index;
  const number = el('span', current ? 'bk-card-number is-current' : 'bk-card-number', current ? `${chapter.number} · ${ctx.labels.reading}` : chapter.number);
  const title = el('span', 'bk-card-title');
  title.append(fullTitle(chapter));
  head.append(number, title);
  card.append(head);
  if (chapter.recap !== undefined) card.append(summary('div', 'bk-card-recap bk-card-chapter-recap', chapter.recap));
  else {
    const lead = leadOf(chapter.heading);
    if (lead !== null) card.append(summary('p', 'bk-card-lead bk-card-chapter-lead', lead));
  }
  if (chapter.sections.length > 0) {
    const list = el('div', 'bk-card-sections');
    for (const section of chapter.sections) {
      const row = tocLink(section.id, 'bk-card-section');
      row.dataset.index = section.index;
      row.classList.toggle('is-read', state.read[section.index]);
      row.classList.toggle('is-current', state.entry === section.index);
      row.append(el('span', 'bk-card-section-title', section.title));
      if (section.recap !== undefined) row.append(summary('span', 'bk-card-recap', section.recap));
      else {
        const lead = leadOf(section.heading);
        if (lead !== null) row.append(summary('span', 'bk-card-lead', lead));
      }
      list.append(row);
    }
    card.append(list);
  }
  return card;
}

export function hoverIntent(delay) {
  let showTimer = 0;
  let hideTimer = 0;
  let warmUntil = 0;
  let shown = false;
  return {
    get shown() {
      return shown;
    },
    enter(show) {
      clearTimeout(hideTimer);
      clearTimeout(showTimer);
      const run = () => {
        shown = true;
        show();
      };
      if (shown || performance.now() < warmUntil) run();
      else showTimer = setTimeout(run, delay);
    },
    stay() {
      clearTimeout(hideTimer);
    },
    leave(hide) {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (shown) warmUntil = performance.now() + WARM_TIME;
        shown = false;
        hide();
      }, HIDE_DELAY);
    },
    stop() {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      shown = false;
    },
  };
}

export function floorOf() {
  const toggle = document.querySelector('.bk-settings-toggle');
  const top = toggle === null ? innerHeight : toggle.getBoundingClientRect().top;
  return Math.min(innerHeight, top) - 8;
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

function summary(tag, className, html) {
  const element = el(tag, className);
  element.append(cleaned(html));
  return element;
}

function fullTitle(chapter) {
  const text = chapter.heading?.querySelector('.bk-heading-text');
  return text === null || text === undefined ? document.createTextNode(chapter.title) : cleaned(text.innerHTML);
}

const leads = new WeakMap();

function leadOf(heading) {
  if (heading === null) return null;
  if (!leads.has(heading)) leads.set(heading, findLead(heading));
  return leads.get(heading);
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
