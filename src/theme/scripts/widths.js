const SCROLLERS = 'pre.shiki, .table-scroll, mjx-container[display]';

export function resolveWidths(article) {
  const measured = [...article.querySelectorAll('.bk-block[data-width="auto"]')].filter((block) => !declaresNaturalWidth(block));
  for (const block of measured) resolve(block, 'body');
  const wide = measured.filter(overflows);
  for (const block of wide) resolve(block, 'wide');
}

function resolve(block, width) {
  if (block.dataset.resolved !== width) block.dataset.resolved = width;
}

export function declaresNaturalWidth(block) {
  return getComputedStyle(block).getPropertyValue('--natural-width').trim() !== '';
}

export function naturalWidth(block) {
  return parseFloat(getComputedStyle(block).getPropertyValue('--natural-box'));
}

export function overflows(block) {
  return [block, ...block.querySelectorAll(SCROLLERS)].some((element) => element.scrollWidth > element.clientWidth + 1);
}
