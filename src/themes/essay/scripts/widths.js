const SCROLLERS = 'pre.shiki, .table-scroll, mjx-container[display]';
const NATURAL_WIDTH_HOSTS = { math: 'mjx-container[display]', code: 'pre.shiki' };

export function startWidths(article) {
  const blocks = [...article.querySelectorAll('.bk-block[data-width]')];
  const scrollers = [...article.querySelectorAll(SCROLLERS)];
  const layout = onFrame(() => {
    resolveWidths(article, blocks);
    scrollers.forEach(updateFades);
    document.dispatchEvent(new CustomEvent('bk:layout'));
  });
  layout();
  new ResizeObserver(layout).observe(article);
  document.fonts.ready.then(layout);
  article.addEventListener('toggle', layout, true);
  for (const scroller of scrollers) {
    const fades = onFrame(() => updateFades(scroller));
    scroller.addEventListener('scroll', fades, { passive: true });
  }
}

function onFrame(callback) {
  let pending = false;
  return () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      callback();
    });
  };
}

function resolveWidths(article, blocks) {
  const body = article.clientWidth;
  const wide = lengthIn(article, 'var(--wide-width)');
  const auto = blocks.filter((block) => block.dataset.width === 'auto');
  for (const block of blocks) {
    if (block.dataset.width !== 'auto') block.dataset.resolved = block.dataset.width;
  }
  const declared = auto.filter((block) => getComputedStyle(block).getPropertyValue('--natural-width').trim() !== '');
  const measured = auto.filter((block) => !declared.includes(block));
  for (const block of measured) block.dataset.resolved = 'body';
  const needsWide = new Set([
    ...declared.filter((block) => naturalWidth(block) > body + 0.5),
    ...measured.filter((block) => overflows(block)),
  ]);
  for (const block of auto) block.dataset.resolved = needsWide.has(block) && wide > body + 0.5 ? 'wide' : 'body';
}

function naturalWidth(block) {
  const selector = NATURAL_WIDTH_HOSTS[block.dataset.type];
  const host = (selector === undefined ? null : block.querySelector(selector)) ?? block;
  const width = lengthIn(host, 'var(--natural-width)');
  if (host === block) return width;
  const style = getComputedStyle(host);
  const edges = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((sum, name) => sum + parseFloat(style[name]), 0);
  return width + edges;
}

function lengthIn(host, length) {
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;visibility:hidden;height:0;padding:0;border:0;width:${length}`;
  host.append(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}

function overflows(block) {
  return [block, ...block.querySelectorAll(SCROLLERS)].some((element) => element.scrollWidth > element.clientWidth + 1);
}

function updateFades(scroller) {
  const left = scroller.scrollLeft > 2;
  const right = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 2;
  scroller.toggleAttribute('data-fade-left', left);
  scroller.toggleAttribute('data-fade-right', right);
}
