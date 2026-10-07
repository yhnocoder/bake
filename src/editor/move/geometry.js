function displayedAsContents(element) {
  return getComputedStyle(element).display === 'contents';
}

export function blockElement(dom) {
  let element = dom;
  while (displayedAsContents(element) && element.firstElementChild) element = element.firstElementChild;
  return element;
}

export function blockRect(dom) {
  if (!displayedAsContents(dom)) return dom.getBoundingClientRect();
  const rects = [...dom.children].map(blockRect).filter((rect) => rect.width > 0 || rect.height > 0);
  if (rects.length === 0) return dom.getBoundingClientRect();
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}
