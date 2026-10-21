export const BLOCKS = '[data-region] [data-line]';
export const FRAMES = '[data-region] figure.component[data-line]';
const FRAME = 'figure.component[data-line]';
// why: these attributes give the place of a node in the source, which moves with every edit above it
const POSITIONS = ['data-line', 'data-end-line', 'data-src'];
const POSITIONED = '[data-line], [data-src]';

export function skeleton(doc) {
  const copy = doc.documentElement.cloneNode(true);
  for (const element of copy.querySelectorAll('[data-bake-dev]')) element.remove();
  for (const region of copy.querySelectorAll('[data-region]')) region.replaceChildren();
  return copy.outerHTML;
}

export function planUpdate(old, next, page, { isPageNode, shownParams }) {
  let changed = false;
  const regions = [];
  for (const region of next.querySelectorAll('[data-region]')) {
    const selector = `[data-region="${CSS.escape(region.dataset.region)}"]`;
    const before = old.querySelector(selector);
    if (before?.innerHTML === region.innerHTML) continue;
    changed = true;
    for (const live of page.querySelectorAll(selector)) {
      const steps = [];
      if (before !== null && planChildren(before, region, live, steps, { isPageNode, shownParams })) regions.push({ live, steps });
      else regions.push({ live, children: [...region.childNodes] });
    }
  }
  return { changed, regions };
}

function planChildren(old, next, live, plan, context) {
  const oldNodes = [...old.childNodes];
  const nextNodes = [...next.childNodes];
  const liveNodes = [...live.childNodes].filter(context.isPageNode);
  if (oldNodes.length !== nextNodes.length || liveNodes.length !== oldNodes.length) return false;
  const steps = [];
  for (const [index, node] of oldNodes.entries()) {
    if (!sameNode(node, liveNodes[index])) return false;
    planNode(node, nextNodes[index], liveNodes[index], steps, context);
  }
  plan.push(...steps);
  return true;
}

function sameNode(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  return !(a instanceof Element) || (a.tagName === b.tagName && a.getAttribute('data-line') === b.getAttribute('data-line'));
}

function planNode(old, next, live, plan, context) {
  if (nodeHtml(old) === nodeHtml(next)) return;
  if (old instanceof Element && next instanceof Element) {
    const frame = frameChange(old, next, live, context);
    if (frame !== null) {
      plan.push(frame);
      return;
    }
    const positions = withoutPositions(old) === withoutPositions(next) ? positionPairs(live, next, context) : null;
    if (positions !== null) {
      plan.push({ positions });
      return;
    }
    if (!next.matches('figure.component') && old.tagName === next.tagName && sameAttributes(old, next) && planChildren(old, next, live, plan, context)) {
      plan.push({ positions: [[live, next]] });
      return;
    }
  }
  plan.push({ live, next });
}

function withoutPositions(element) {
  const copy = element.cloneNode(true);
  for (const part of [copy, ...copy.querySelectorAll(POSITIONED)]) for (const name of POSITIONS) part.removeAttribute(name);
  return copy.outerHTML;
}

function positionPairs(live, next, { isPageNode }) {
  const lives = [live, ...live.querySelectorAll(POSITIONED)].filter(isPageNode);
  const nexts = [next, ...next.querySelectorAll(POSITIONED)];
  return lives.length === nexts.length ? lives.map((element, index) => [element, nexts[index]]) : null;
}

export function movePositions(pairs) {
  for (const [live, next] of pairs) {
    for (const name of POSITIONS) {
      const value = next.getAttribute(name);
      if (value === null) live.removeAttribute(name);
      else live.setAttribute(name, value);
    }
  }
}

function nodeHtml(node) {
  return node instanceof Element ? node.outerHTML : node.textContent;
}

function sameAttributes(a, b) {
  const written = (element) => [...element.attributes].filter((attribute) => !POSITIONS.includes(attribute.name));
  return written(a).length === written(b).length && written(a).every((attribute) => b.getAttribute(attribute.name) === attribute.value);
}

function frameChange(old, next, live, context) {
  if (!old.matches(FRAME) || !next.matches(FRAME) || old.dataset.component !== next.dataset.component) return null;
  const strip = (frame) => {
    const copy = frame.cloneNode(true);
    copy.removeAttribute('data-params');
    copy.removeAttribute('data-attributes');
    copy.querySelector(':scope > .component-box')?.removeAttribute('style');
    return withoutPositions(copy);
  };
  if (strip(old) !== strip(next)) return null;
  const positions = positionPairs(live, next, context);
  if (positions === null) return null;
  const params = JSON.parse(next.dataset.params);
  const shown = context.shownParams(live) ?? JSON.parse(old.dataset.params);
  if (!sameValues(shown, params)) return null;
  return { frame: live, positions, params: next.dataset.params, attributes: next.dataset.attributes, boxStyle: next.querySelector(':scope > .component-box')?.getAttribute('style') ?? null };
}

function sameValues(a, b) {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && a[key] === b[key]);
}

function blocksOf(doc) {
  return [...doc.querySelectorAll(BLOCKS)].map((element) => ({ line: element.dataset.line, signature: withoutPositions(element) }));
}

export function changedLines(old, next) {
  const counts = new Map();
  for (const { signature } of blocksOf(old)) counts.set(signature, (counts.get(signature) ?? 0) + 1);
  const lines = [];
  for (const { line, signature } of blocksOf(next)) {
    const count = counts.get(signature) ?? 0;
    if (count > 0) counts.set(signature, count - 1);
    else lines.push(line);
  }
  return lines;
}

export function frameMoves(old, next) {
  const before = framesOf(old);
  const free = framesOf(next);
  const moves = new Map();
  const left = [];
  for (const frame of before) {
    const same = free.findIndex((candidate) => candidate.signature === frame.signature);
    if (same === -1) left.push(frame);
    else moves.set(frame.key, free.splice(same, 1)[0].key);
  }
  for (const name of new Set(left.map((frame) => frame.name))) {
    const removed = left.filter((frame) => frame.name === name);
    const added = free.filter((frame) => frame.name === name);
    if (removed.length === added.length) removed.forEach((frame, index) => moves.set(frame.key, added[index].key));
  }
  return moves;
}

function framesOf(doc) {
  const seen = new Map();
  return [...doc.querySelectorAll(FRAMES)].map((frame) => {
    const name = frame.dataset.component;
    const index = seen.get(name) ?? 0;
    seen.set(name, index + 1);
    return { name, key: `${name} ${index}`, signature: withoutPositions(frame) };
  });
}

export function anchorFor(old, next, line) {
  const before = blocksOf(old);
  const index = before.findIndex((block) => block.line === line);
  if (index === -1) return null;
  const { signature } = before[index];
  const occurrence = before.slice(0, index).filter((block) => block.signature === signature).length;
  return blocksOf(next).filter((block) => block.signature === signature)[occurrence]?.line ?? null;
}

export function sectionOf(outline, line) {
  const entry = outline.findLast((candidate) => candidate.line <= line);
  return entry === undefined ? 'the introduction' : entry.title;
}
