import { copyText, createOverlay } from './overlay.js';
import { BLOCKS, anchorFor, changedLines, frameMoves, movePositions, planUpdate, sectionOf, skeleton } from './regions.js';

const script = document.querySelector('script[data-bake-dev]');
const { source, missing, file, token } = script.dataset;
const scrollKey = `bake-dev-scroll:${location.pathname}`;
const pagePath = location.pathname.replace(/index\.html$/, '');
const BARS_KEY = 'bake-dev-param-bars';
// why: the preview of the Bake extension for VS Code shows this page in a frame and talks to it with messages
const editor = window.parent === window ? null : window.parent;
// why: only a scroll that the reader starts moves the editor; the page also scrolls itself to keep the text in place after an update
const READER_SCROLL_TIME = 500;
let readerScrolled = -Infinity;
let pointerDown = false;
let scrollQueued = false;
let cursorLine = null;

let pristine = null;
let outline = JSON.parse(script.dataset.outline ?? '[]');
let version = script.dataset.version;
let components = JSON.parse(script.dataset.components ?? '{}');
let serverId = null;
let refreshing = null;
let refreshAgain = false;
const pageNodes = new WeakSet();
for (const region of document.querySelectorAll('[data-region]')) for (const node of region.childNodes) rememberPageNode(node);

const overlay = createOverlay();
let barControls = null;
const bars = file === undefined ? null : startBars();
restoreScroll();
const loaded =
  missing === undefined
    ? fetchPage().then((page) => {
        if (page.ok) pristine = page.document;
      })
    : Promise.resolve();
const connected = connect();
Promise.all([loaded, connected]).then(overlay.ready);
document.addEventListener('dblclick', openInEditor);
if (editor !== null) {
  addEventListener('message', answerEditor);
  for (const type of ['wheel', 'touchmove', 'keydown']) addEventListener(type, () => (readerScrolled = performance.now()), { passive: true });
  addEventListener('pointerdown', () => (pointerDown = true));
  for (const type of ['pointerup', 'pointercancel']) addEventListener(type, () => (pointerDown = false));
  addEventListener('scroll', followReader, { passive: true });
  document.addEventListener('click', openOutside);
  editor.postMessage({ bake: 'ready', file: file ?? null }, '*');
}

function connect() {
  const events = new EventSource('/__bake/events');
  const connected = new Promise((done) => events.addEventListener('hello', done, { once: true }));
  events.addEventListener('hello', (event) => {
    const { id } = JSON.parse(event.data);
    if (serverId !== null && serverId !== id) reloadPage();
    else if (serverId === id && missing === undefined) queueRefresh();
    else if (serverId === id) reloadPage();
    serverId = id;
  });
  events.addEventListener('problems', (event) => overlay.showProblems(JSON.parse(event.data)));
  events.addEventListener('update', (event) => {
    const { reload, refresh } = JSON.parse(event.data);
    if (missing !== undefined || reload === 'all' || reload.includes(pagePath)) reloadPage();
    else if (refresh.includes(pagePath)) queueRefresh();
  });
  return connected;
}

function startBars() {
  const shown = barsShown();
  overlay.showBarSwitch(shown, (value) => {
    try {
      localStorage.setItem(BARS_KEY, value ? 'shown' : 'hidden');
    } catch {}
    bars.then((module) => module.setShown(value));
  });
  return import('./param-bar.js').then((module) =>
    module
      .startParamBars({
        file,
        token,
        version: () => version,
        setVersion: (next) => {
          version = next;
        },
        components: () => components,
        copyText,
        shown,
      })
      .then((controls) => {
        barControls = controls;
        return controls;
      }),
  );
}

function barsShown() {
  try {
    return localStorage.getItem(BARS_KEY) !== 'hidden';
  } catch {
    return true;
  }
}

async function fetchPage() {
  const response = await fetch(location.pathname, { cache: 'no-store' });
  const text = await response.text();
  return { ok: response.ok, document: new DOMParser().parseFromString(text, 'text/html') };
}

function queueRefresh() {
  if (refreshing !== null) {
    refreshAgain = true;
    return;
  }
  refreshing = refresh().finally(() => {
    refreshing = null;
    if (refreshAgain) {
      refreshAgain = false;
      queueRefresh();
    }
  });
}

async function refresh() {
  const page = await fetchPage();
  const next = page.document;
  if (!page.ok || pristine === null || skeleton(next) !== skeleton(pristine)) {
    reloadPage();
    return;
  }
  overlay.hideNotice();
  const lines = changedLines(pristine, next);
  const anchor = findAnchor(pristine, next);
  const details = detailsState();
  const { changed, regions } = planUpdate(pristine, next, document, { isPageNode: (node) => pageNodes.has(node), shownParams: (frame) => barControls?.shown(frame) ?? null });
  barControls?.move(frameMoves(pristine, next));
  const kept = applyUpdate(regions);
  pristine = next;
  const data = next.querySelector('script[data-bake-dev]')?.dataset ?? {};
  outline = JSON.parse(data.outline ?? '[]');
  version = data.version;
  components = JSON.parse(data.components ?? '{}');
  if (!changed) return;
  restoreDetails(details);
  barControls?.scan();
  // why: src/shared/live.js starts the scripts of the page again on this event
  document.dispatchEvent(new CustomEvent('bake:update'));
  if (anchor !== null) {
    anchor.align();
    requestAnimationFrame(() => requestAnimationFrame(anchor.align));
  }
  // why: in the preview of an editor the page changes with each key, so it marks the block at the cursor of the editor instead of each changed block
  if (editor === null) showChanges(lines, kept);
  else showCursor();
}

function applyUpdate(regions) {
  const kept = [];
  for (const { live, steps, children } of regions) {
    if (children !== undefined) {
      live.replaceChildren(...children.map(importPageNode));
      continue;
    }
    for (const step of steps) {
      if (step.frame !== undefined) kept.push(keepFrame(step));
      else if (step.positions !== undefined) movePositions(step.positions);
      else step.live.replaceWith(importPageNode(step.next));
    }
  }
  return kept;
}

function rememberPageNode(node) {
  pageNodes.add(node);
  for (const child of node.childNodes) rememberPageNode(child);
}

function importPageNode(node) {
  const copy = document.importNode(node, true);
  rememberPageNode(copy);
  return copy;
}

function keepFrame({ frame, positions, params, attributes, boxStyle }) {
  movePositions(positions);
  frame.dataset.params = params;
  if (attributes === undefined) delete frame.dataset.attributes;
  else frame.dataset.attributes = attributes;
  const box = frame.querySelector(':scope > .component-box');
  if (box !== null && boxStyle !== null) box.setAttribute('style', boxStyle);
  barControls?.rebase(frame);
  return frame;
}

function visibleBlock(line) {
  return [...document.querySelectorAll(`${BLOCKS}[data-line="${CSS.escape(line)}"]`)].find(isShown) ?? null;
}

function isShown(element) {
  return element.checkVisibility() && element.getClientRects().length > 0;
}

function findAnchor(old, next) {
  const element = [...document.querySelectorAll(BLOCKS)].find((candidate) => isShown(candidate) && candidate.getBoundingClientRect().top >= 0);
  if (element === undefined) return null;
  const top = element.getBoundingClientRect().top;
  const line = anchorFor(old, next, element.dataset.line);
  if (line === null) return null;
  return {
    align: () => {
      const target = visibleBlock(line);
      if (target !== null) scrollBy({ top: target.getBoundingClientRect().top - top, behavior: 'instant' });
    },
  };
}

function detailsKeys() {
  const seen = new Map();
  return [...document.querySelectorAll('[data-region] details')].map((details) => {
    const title = details.querySelector(':scope > summary')?.textContent.trim() ?? '';
    const count = seen.get(title) ?? 0;
    seen.set(title, count + 1);
    return { details, key: `${title}\n${count}` };
  });
}

function detailsState() {
  return new Map(detailsKeys().map(({ details, key }) => [key, details.open]));
}

function restoreDetails(state) {
  for (const { details, key } of detailsKeys()) {
    if (state.has(key)) details.open = state.get(key);
  }
}

function showChanges(lines, kept) {
  const changed = new Set(lines);
  const lineElements = [...document.querySelectorAll(BLOCKS)].filter((element) => changed.has(element.dataset.line) && !kept.some((frame) => element.contains(frame)));
  const elements = lineElements.filter((element) => !lineElements.some((other) => other !== element && other.contains(element)));
  elements.forEach(overlay.mark);
  const shown = elements.filter(isShown);
  if (shown.length === 0) return;
  const boxes = shown.map((element) => element.getBoundingClientRect());
  if (boxes.some((box) => box.bottom > 0 && box.top < innerHeight)) return;
  const first = shown[0];
  const direction = boxes[0].top < 0 ? 'above' : 'below';
  overlay.showNotice(`Changed ${direction} in ${sectionOf(outline, Number(first.dataset.line))}`, direction, () => {
    first.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    shown.forEach(overlay.mark);
  });
}

function reloadPage() {
  try {
    sessionStorage.setItem(scrollKey, JSON.stringify(scrollAnchor()));
  } catch {}
  location.reload();
}

// why: a component without a height shows a placeholder until it starts again after the reload, so the same scroll offset would show other text
function scrollAnchor() {
  const index = [...document.querySelectorAll(BLOCKS)].findIndex((block) => isShown(block) && block.getBoundingClientRect().top >= 0);
  return { index, top: anchorElement(index).getBoundingClientRect().top };
}

function anchorElement(index) {
  return index === -1 ? document.documentElement : document.querySelectorAll(BLOCKS)[index];
}

function restoreScroll() {
  let saved = null;
  try {
    saved = sessionStorage.getItem(scrollKey);
    sessionStorage.removeItem(scrollKey);
  } catch {}
  if (saved === null) return;
  history.scrollRestoration = 'manual';
  const { index, top } = JSON.parse(saved);
  const apply = () => {
    const element = anchorElement(index);
    if (element !== undefined) scrollBy({ top: element.getBoundingClientRect().top - top, behavior: 'instant' });
  };
  apply();
  addEventListener(
    'load',
    () => {
      apply();
      requestAnimationFrame(() => requestAnimationFrame(apply));
      document.fonts.ready.then(apply);
    },
    { once: true },
  );
}

function openInEditor(event) {
  if (source === undefined || !(event.target instanceof Element) || event.target.closest('input, textarea, select') !== null) return;
  if (event.composedPath().some((target) => target instanceof Element && target.matches('bake-param-bar'))) return;
  const block = event.target.closest(BLOCKS);
  if (block === null) return;
  if (editor === null) window.open(`vscode://file${source}:${block.dataset.line}:1`, '_self');
  else editor.postMessage({ bake: 'open', file, line: Number(block.dataset.line) }, '*');
}

// why: most other sites refuse to be shown in a frame, so a link to them would leave the preview empty; the editor opens them in the browser
function openOutside(event) {
  const link = event.composedPath().find((target) => target instanceof HTMLAnchorElement && target.href !== '');
  if (link === undefined || new URL(link.href).origin === location.origin) return;
  event.preventDefault();
  editor.postMessage({ bake: 'link', url: link.href }, '*');
}

function answerEditor(event) {
  if (event.source !== editor) return;
  const { bake, line, text } = event.data ?? {};
  if (bake === 'reveal' && Number.isInteger(line) && !readerScrolling()) reveal(line);
  if (bake === 'cursor' && Number.isInteger(line)) {
    cursorLine = line;
    showCursor();
  }
  if (bake === 'source' && token !== undefined && (typeof text === 'string' || text === null)) {
    fetch('/__bake/source', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bake-token': token }, body: JSON.stringify({ file: event.data.file, text }) });
  }
}

function showCursor() {
  const blocks = [...document.querySelectorAll(BLOCKS)].filter((block) => Number(block.dataset.line) <= cursorLine && cursorLine <= Number(block.dataset.endLine ?? block.dataset.line) && isShown(block));
  overlay.showCursor(blocks.at(-1) ?? null);
}

function readerScrolling() {
  return pointerDown || performance.now() - readerScrolled < READER_SCROLL_TIME;
}

function followReader() {
  if (scrollQueued || !readerScrolling()) return;
  scrollQueued = true;
  requestAnimationFrame(() => {
    scrollQueued = false;
    const positions = linePositions();
    const top = scrollY + scrollPadding();
    const index = positions.findLastIndex((position) => position.top <= top);
    if (index === -1) return editor.postMessage({ bake: 'scroll', file, line: positions[0]?.line ?? 1 }, '*');
    const [current, next] = [positions[index], positions[index + 1]];
    const line = next === undefined ? current.line : current.line + ((top - current.top) / (next.top - current.top)) * (next.line - current.line);
    editor.postMessage({ bake: 'scroll', file, line: Math.floor(line) }, '*');
  });
}

function reveal(line) {
  const positions = linePositions();
  const index = positions.findLastIndex((position) => position.line <= line);
  if (index === -1) return scrollTo({ top: 0, behavior: 'instant' });
  const [current, next] = [positions[index], positions[index + 1]];
  const top = next === undefined ? current.top : current.top + ((line - current.line) / (next.line - current.line)) * (next.top - current.top);
  scrollTo({ top: top - scrollPadding(), behavior: 'instant' });
}

// why: the editor scrolls by lines and the page by pixels, so a line between the starts of two blocks is placed at the same fraction of the distance between their tops; blocks that the theme places out of order, such as sidenotes in the margin, are left out
function linePositions() {
  const positions = [];
  for (const block of document.querySelectorAll(BLOCKS)) {
    if (block.parentElement.closest(BLOCKS) !== null || !isShown(block)) continue;
    const position = { line: Number(block.dataset.line), top: block.getBoundingClientRect().top + scrollY };
    const last = positions.at(-1);
    if (last === undefined || (position.line > last.line && position.top > last.top)) positions.push(position);
  }
  return positions;
}

function scrollPadding() {
  return parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
}
