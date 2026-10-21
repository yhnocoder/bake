import { copyText, createOverlay } from './overlay.js';
import { BLOCKS, anchorFor, changedLines, frameMoves, planUpdate, sectionOf, skeleton } from './regions.js';

const script = document.querySelector('script[data-bake-dev]');
const { source, missing, file, token } = script.dataset;
const scrollKey = `bake-dev-scroll:${location.pathname}`;
const pagePath = location.pathname.replace(/index\.html$/, '');
const BARS_KEY = 'bake-dev-param-bars';

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
  // why: src/live.js starts the scripts of the page again on this event
  document.dispatchEvent(new CustomEvent('bake:update'));
  if (anchor !== null) {
    anchor.align();
    requestAnimationFrame(() => requestAnimationFrame(anchor.align));
  }
  showChanges(lines, kept);
}

function applyUpdate(regions) {
  const kept = [];
  for (const { live, steps, children } of regions) {
    if (children !== undefined) {
      live.replaceChildren(...children.map(importPageNode));
      continue;
    }
    for (const step of steps) {
      if (step.frame === undefined) step.live.replaceWith(importPageNode(step.next));
      else kept.push(keepFrame(step));
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

function keepFrame({ frame, params, attributes, boxStyle }) {
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
    sessionStorage.setItem(scrollKey, String(scrollY));
  } catch {}
  location.reload();
}

function restoreScroll() {
  let saved = null;
  try {
    saved = sessionStorage.getItem(scrollKey);
    sessionStorage.removeItem(scrollKey);
  } catch {}
  if (saved === null) return;
  history.scrollRestoration = 'manual';
  const apply = () => scrollTo({ top: Number(saved), behavior: 'instant' });
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
  window.open(`vscode://file${source}:${block.dataset.line}:1`, '_self');
}
