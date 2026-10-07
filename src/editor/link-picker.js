import { closeHistory } from '@milkdown/prose/history';
import { keymap } from '@milkdown/prose/keymap';
import { Plugin, TextSelection } from '@milkdown/prose/state';
import { $prose } from '@milkdown/utils';

const kindLabels = { page: '文章', heading: '标题', block: '段落' };
const kindOrder = { page: 0, heading: 1, block: 2 };
const maxCandidates = 20;
const viewportMargin = 16;

let openPicker = null;

function candidatesOf(pages) {
  const list = [];
  for (const page of pages) {
    list.push({ kind: 'page', text: page.title ?? page.url, id: null, url: page.url, pageTitle: page.title ?? page.url });
    for (const section of page.sections) list.push({ kind: section.kind, text: section.text, id: section.id, url: page.url, pageTitle: page.title ?? page.url });
  }
  return list.map((candidate, order) => ({ ...candidate, order }));
}

function tierOf(candidate, query) {
  const text = candidate.text.toLowerCase();
  if (text.startsWith(query)) return 0;
  if (text.includes(query)) return 1;
  if ((candidate.id ?? '').toLowerCase().includes(query) || candidate.url.toLowerCase().includes(query)) return 2;
  return null;
}

function ranked(candidates, input, currentUrl) {
  const query = input.trim().toLowerCase();
  if (query === '') {
    const current = candidates.filter((candidate) => candidate.url === currentUrl && candidate.kind !== 'page');
    return [...current, ...candidates.filter((candidate) => !current.includes(candidate))].slice(0, maxCandidates);
  }
  return candidates
    .map((candidate) => ({ candidate, tier: tierOf(candidate, query) }))
    .filter(({ tier }) => tier !== null)
    .sort((a, b) => a.tier - b.tier || kindOrder[a.candidate.kind] - kindOrder[b.candidate.kind] || a.candidate.order - b.candidate.order)
    .slice(0, maxCandidates)
    .map(({ candidate }) => candidate);
}

function hrefOf(candidate, currentUrl) {
  if (candidate.url === currentUrl && candidate.id !== null) return `#${candidate.id}`;
  const path = candidate.url === '/' ? '/' : candidate.url.replace(/\/$/, '');
  return candidate.id === null ? path : `${path}#${candidate.id}`;
}

function defaultText(candidate) {
  return candidate.kind === 'heading' ? candidate.text : candidate.pageTitle;
}

function linkAt(state) {
  const type = state.schema.marks.link;
  const { selection } = state;
  const $from = selection.$from;
  const candidates = selection.empty ? [$from.nodeAfter, $from.nodeBefore] : [$from.nodeAfter];
  for (const node of candidates) {
    const mark = node && type.isInSet(node.marks);
    if (mark) return { mark, range: linkRange($from, mark) };
  }
  return null;
}

function linkRange($pos, mark) {
  const start = $pos.start();
  const position = $pos.parentOffset;
  let runStart = null;
  let found = null;
  $pos.parent.forEach((child, offset) => {
    if (found) return;
    if (mark.isInSet(child.marks)) {
      if (runStart === null) runStart = offset;
      if (position >= runStart && position <= offset + child.nodeSize) found = { from: start + runStart, to: start + offset + child.nodeSize };
    } else {
      runStart = null;
    }
  });
  return found;
}

function applyLink(view, { href, text }, existing) {
  const { state } = view;
  const type = state.schema.marks.link;
  const tr = closeHistory(state.tr);
  if (existing) {
    tr.removeMark(existing.range.from, existing.range.to, type);
    if (href !== null) tr.addMark(existing.range.from, existing.range.to, type.create({ href }));
  } else if (!state.selection.empty) {
    tr.addMark(state.selection.from, state.selection.to, type.create({ href }));
  } else {
    const from = state.selection.from;
    tr.replaceSelectionWith(state.schema.text(text, [type.create({ href })]), false);
    tr.setSelection(TextSelection.create(tr.doc, from + text.length));
    tr.removeStoredMark(type);
  }
  view.dispatch(tr.scrollIntoView());
}

function option(candidate, selected) {
  const item = document.createElement('li');
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', String(selected));
  const kind = document.createElement('span');
  kind.className = 'link-picker-kind';
  kind.textContent = kindLabels[candidate.kind];
  const text = document.createElement('span');
  text.className = 'link-picker-text';
  text.textContent = candidate.text;
  const target = document.createElement('span');
  target.className = 'link-picker-target';
  target.textContent = candidate.kind === 'page' ? candidate.url : `${candidate.pageTitle} #${candidate.id}`;
  item.append(kind, text, target);
  return item;
}

export function openLinkPicker(view) {
  openPicker?.close();
  const existing = linkAt(view.state);
  const currentUrl = location.pathname;
  let candidates = [];
  let shown = [];
  let highlighted = 0;

  const element = document.createElement('div');
  element.className = 'link-picker';
  element.dataset.bakeDev = '';
  const input = document.createElement('input');
  input.placeholder = '输入文章标题、标题文字或段落 id，或粘贴网址';
  input.value = existing?.mark.attrs.href ?? '';
  const list = document.createElement('ul');
  list.setAttribute('role', 'listbox');
  element.append(input, list);

  function render() {
    shown = ranked(candidates, input.value, currentUrl);
    highlighted = Math.min(highlighted, Math.max(shown.length - 1, 0));
    list.replaceChildren(
      ...shown.map((candidate, index) => {
        const item = option(candidate, index === highlighted);
        item.addEventListener('mousedown', (event) => event.preventDefault());
        item.addEventListener('click', () => choose(candidate));
        return item;
      }),
    );
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  function close({ focus = true } = {}) {
    if (openPicker !== picker) return;
    openPicker = null;
    document.removeEventListener('mousedown', onOutside, true);
    element.remove();
    if (focus) view.focus();
  }

  function finish(link) {
    close();
    applyLink(view, link, existing);
  }

  function choose(candidate) {
    finish({ href: hrefOf(candidate, currentUrl), text: defaultText(candidate) });
  }

  function confirm() {
    const value = input.value.trim();
    if (value.startsWith('http://') || value.startsWith('https://')) finish({ href: value, text: value });
    else if (value === '' && existing) finish({ href: null, text: '' });
    else if (shown.length > 0) choose(shown[highlighted]);
  }

  function onOutside(event) {
    if (!element.contains(event.target)) close();
  }

  input.addEventListener('input', () => {
    highlighted = 0;
    render();
  });
  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (shown.length > 0) highlighted = (highlighted + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      render();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      confirm();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });

  const picker = { close };
  openPicker = picker;
  document.addEventListener('mousedown', onOutside, true);
  const coords = view.coordsAtPos(view.state.selection.from);
  element.style.top = `${coords.bottom + window.scrollY}px`;
  document.body.append(element);
  const left = Math.max(viewportMargin, Math.min(coords.left, document.documentElement.clientWidth - viewportMargin - element.offsetWidth));
  element.style.left = `${left + window.scrollX}px`;
  input.focus();
  input.select();
  fetch('/__bake/sections')
    .then((response) => {
      if (!response.ok) throw new Error(`/__bake/sections returned ${response.status}`);
      return response.json();
    })
    .then((data) => {
      if (openPicker !== picker) return;
      candidates = candidatesOf(data.pages);
      render();
    })
    .catch(() => {
      if (openPicker !== picker) return;
      const message = document.createElement('li');
      message.className = 'link-picker-message';
      message.textContent = '无法读取站内的文章和标题';
      list.replaceChildren(message);
    });
  return picker;
}

export const linkMenuItem = {
  label: '链接',
  keywords: ['link', '链接'],
  run(view, range) {
    view.dispatch(closeHistory(view.state.tr).delete(range.from + 1, range.to - 1));
    openLinkPicker(view);
  },
};

export const linkPicker = [
  $prose(() =>
    keymap({
      'Mod-k': (state, dispatch, view) => {
        openLinkPicker(view);
        return true;
      },
    }),
  ),
  $prose(
    () =>
      new Plugin({
        view: () => ({
          update: (view, previous) => {
            if (view.state.doc !== previous.doc) openPicker?.close({ focus: false });
          },
          destroy: () => openPicker?.close({ focus: false }),
        }),
      }),
  ),
];
