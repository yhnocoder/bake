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
  const card = el('div', 'bk-toc-card');
  const head = tocLink(chapter.id, 'bk-toc-card-head');
  head.dataset.index = chapter.index;
  const number = el('span', current ? 'bk-toc-card-number is-current' : 'bk-toc-card-number', current ? `${chapter.number} · ${ctx.labels.reading}` : chapter.number);
  const title = el('span', 'bk-toc-card-title');
  title.append(fullTitle(chapter));
  head.append(number, title);
  card.append(head);
  if (chapter.recap !== undefined) card.append(summary('div', 'bk-toc-card-recap bk-toc-card-chapter-recap', chapter.recap));
  else {
    const lead = leadOf(chapter.heading);
    if (lead !== null) card.append(summary('p', 'bk-toc-card-lead bk-toc-card-chapter-lead', lead));
  }
  if (chapter.sections.length > 0) {
    const list = el('div', 'bk-toc-card-sections');
    for (const section of chapter.sections) {
      const row = tocLink(section.id, 'bk-toc-card-section');
      row.dataset.index = section.index;
      row.classList.toggle('is-read', state.read[section.index]);
      row.classList.toggle('is-current', state.entry === section.index);
      row.append(el('span', 'bk-toc-card-section-title', section.title));
      if (section.recap !== undefined) row.append(summary('span', 'bk-toc-card-recap', section.recap));
      else {
        const lead = leadOf(section.heading);
        if (lead !== null) row.append(summary('span', 'bk-toc-card-lead', lead));
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
    enter(show, now = false) {
      clearTimeout(hideTimer);
      clearTimeout(showTimer);
      const run = () => {
        shown = true;
        show();
      };
      if (now || shown || performance.now() < warmUntil) run();
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

export function cardKeyboard({ entries, card, shown, leave }) {
  const links = () => [...card.querySelectorAll('.bk-toc-card a[href]')];
  for (const [index, entry] of entries.entries()) {
    entry.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab' || event.shiftKey || shown() !== index) return;
      const first = links()[0];
      if (first === undefined) return;
      event.preventDefault();
      first.focus({ preventScroll: true });
    });
  }
  card.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const all = links();
    const index = shown();
    if (index < 0) return;
    if (event.shiftKey && event.target === all[0]) {
      event.preventDefault();
      entries[index].focus({ preventScroll: true });
    } else if (!event.shiftKey && event.target === all.at(-1) && index + 1 < entries.length) {
      event.preventDefault();
      entries[index + 1].focus({ preventScroll: true });
    }
  });
  const inside = (element) => element instanceof Node && (card.contains(element) || entries.some((entry) => entry.parentElement.contains(element)));
  for (const element of [card, ...entries]) {
    element.addEventListener('focusout', (event) => {
      if (!inside(event.relatedTarget)) leave();
    });
  }
}

export function floorFor(left) {
  const toggle = document.querySelector('.bk-settings-toggle')?.getBoundingClientRect();
  if (toggle === undefined || left >= toggle.right) return innerHeight - 12;
  return Math.min(innerHeight - 12, toggle.top - 8);
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
