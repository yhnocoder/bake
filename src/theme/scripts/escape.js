import { composing } from 'bake/keys';

const overlays = new Map();

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || event.defaultPrevented || composing(event)) return;
  let closed = false;
  for (const [element, close] of overlays) {
    if (!element.isConnected) overlays.delete(element);
    else if (close()) closed = true;
  }
  if (closed) event.preventDefault();
});

export function closeOnEscape(element, close) {
  overlays.set(element, close);
}
