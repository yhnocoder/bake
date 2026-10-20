export function markCurrent(element, current) {
  if (element.hasAttribute('aria-current') === current) return;
  if (current) element.setAttribute('aria-current', 'true');
  else element.removeAttribute('aria-current');
}
