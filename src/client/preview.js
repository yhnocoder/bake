import { addGlyphs } from './math-defs.js';

const openDelay = 300;
const closeDelay = 200;
const gap = 8;
const viewportMargin = 16;
const excluded = 'a.anchor, .sidenote-ref a, a.eqref';

function previewLink(target) {
  const link = target.closest?.('article a[href]');
  if (!link || link.matches(excluded)) return null;
  const href = link.getAttribute('href');
  return href.startsWith('/') || href.startsWith('#') ? link : null;
}

function targetOf(link) {
  const url = new URL(link.getAttribute('href'), location.href);
  const page = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  if (url.hash.length <= 1) return { page, id: null };
  try {
    return { page, id: decodeURIComponent(url.hash.slice(1)) };
  } catch {
    return { page, id: url.hash.slice(1) };
  }
}

function referenceRect(link, point) {
  const rects = [...link.getClientRects()];
  const inside = rects.find((rect) => point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom);
  if (inside) return inside;
  const distance = (rect) => Math.abs((rect.top + rect.bottom) / 2 - point.y);
  return rects.reduce((best, rect) => (distance(rect) < distance(best) ? rect : best), rects[0]);
}

function createCard(preview) {
  const card = document.createElement('div');
  card.className = 'link-preview';
  if (preview.title) {
    const title = document.createElement('p');
    title.className = 'link-preview-title';
    title.textContent = preview.title;
    card.append(title);
  }
  const body = document.createElement('div');
  body.className = 'link-preview-body';
  body.innerHTML = preview.html;
  card.append(body);
  return card;
}

function place(card, rect, components) {
  card.style.visibility = 'hidden';
  document.body.append(card);
  const viewportWidth = document.documentElement.clientWidth;
  const pending = components.some((name) => !customElements.get(name));
  const height = pending ? parseFloat(getComputedStyle(card).maxHeight) : card.offsetHeight;
  const below = window.innerHeight - rect.bottom - gap;
  const above = rect.top - gap;
  const top = height <= below || above <= below ? rect.bottom + gap : rect.top - gap - height;
  const left = Math.max(viewportMargin, Math.min(rect.left, viewportWidth - viewportMargin - card.offsetWidth));
  card.style.top = `${top + window.scrollY}px`;
  card.style.left = `${left + window.scrollX}px`;
  card.style.visibility = '';
}

function loadComponents({ components, scripts }) {
  for (const name of components) {
    if (!customElements.get(name) && scripts[name]) import(/* @vite-ignore */ scripts[name]);
  }
}

export function installPreview({ load }) {
  const point = { x: 0, y: 0 };
  let hovered = null;
  let openTimer = null;
  let closeTimer = null;
  let shown = null;

  function cancelClose() {
    clearTimeout(closeTimer);
    closeTimer = null;
  }

  function close() {
    cancelClose();
    shown?.card.remove();
    shown = null;
  }

  function scheduleClose() {
    if (!shown) return;
    cancelClose();
    closeTimer = setTimeout(close, closeDelay);
  }

  async function open(link) {
    const preview = await load(targetOf(link)).catch(() => null);
    if (hovered !== link || !preview) return;
    close();
    addGlyphs(preview.glyphs);
    const card = createCard(preview);
    place(card, referenceRect(link, point), preview.components);
    shown = { card, link };
    loadComponents(preview);
  }

  document.addEventListener('pointermove', (event) => {
    point.x = event.clientX;
    point.y = event.clientY;
  });

  document.addEventListener('pointerover', (event) => {
    if (event.pointerType !== 'mouse') return;
    point.x = event.clientX;
    point.y = event.clientY;
    if (shown && event.target.closest?.('.link-preview') === shown.card) {
      cancelClose();
      return;
    }
    const link = previewLink(event.target);
    if (!link || link === hovered) return;
    hovered = link;
    clearTimeout(openTimer);
    if (shown?.link === link) {
      cancelClose();
      return;
    }
    openTimer = setTimeout(() => open(link), openDelay);
  });

  document.addEventListener('pointerout', (event) => {
    if (event.pointerType !== 'mouse') return;
    const next = event.relatedTarget;
    if (shown && event.target.closest?.('.link-preview') === shown.card) {
      if (!shown.card.contains(next)) scheduleClose();
      return;
    }
    if (!hovered || !hovered.contains(event.target) || hovered.contains(next)) return;
    hovered = null;
    clearTimeout(openTimer);
    scheduleClose();
  });
}
