const SCROLLERS = 'pre.shiki, .table-scroll, mjx-container[display]';
const NATURAL_WIDTH_HOSTS = { math: 'mjx-container[display]', code: 'pre.shiki' };

export function resolveWidths(article) {
  const blocks = [...article.querySelectorAll('.bk-block[data-width]')];
  const body = article.clientWidth;
  const auto = blocks.filter((block) => block.dataset.width === 'auto');
  for (const block of blocks) {
    if (block.dataset.width !== 'auto') resolve(block, block.dataset.width);
  }
  const declared = auto.filter(declaresNaturalWidth);
  const measured = auto.filter((block) => !declared.includes(block));
  for (const block of measured) resolve(block, 'body');
  const [wide, ...naturals] = naturalWidths([{ host: article, length: 'var(--wide-width)' }, ...declared.map(naturalWidthProbe)]);
  const needsWide = new Set([...declared.filter((block, index) => naturals[index] > body + 0.5), ...measured.filter((block) => overflows(block))]);
  for (const block of auto) resolve(block, needsWide.has(block) && wide > body + 0.5 ? 'wide' : 'body');
}

function resolve(block, width) {
  if (block.dataset.resolved !== width) block.dataset.resolved = width;
}

function declaresNaturalWidth(block) {
  return getComputedStyle(block).getPropertyValue('--natural-width').trim() !== '';
}

export function naturalWidth(block) {
  return naturalWidths([naturalWidthProbe(block)])[0];
}

function naturalWidthProbe(block) {
  const selector = NATURAL_WIDTH_HOSTS[block.dataset.type];
  const host = (selector === undefined ? null : block.querySelector(selector)) ?? block;
  return { host, length: 'var(--natural-width)', edges: host !== block };
}

function naturalWidths(requests) {
  const probes = requests.map(({ host, length }) => {
    const probe = document.createElement('div');
    probe.style.cssText = `position:absolute;visibility:hidden;height:0;padding:0;border:0;width:${length}`;
    host.append(probe);
    return probe;
  });
  const widths = requests.map(({ host, edges }, index) => {
    const width = probes[index].getBoundingClientRect().width;
    if (!edges) return width;
    const style = getComputedStyle(host);
    return width + ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((sum, name) => sum + parseFloat(style[name]), 0);
  });
  for (const probe of probes) probe.remove();
  return widths;
}

export function overflows(block) {
  return [block, ...block.querySelectorAll(SCROLLERS)].some((element) => element.scrollWidth > element.clientWidth + 1);
}
