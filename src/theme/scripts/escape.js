const overlays = new Map();

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  for (const [element, close] of overlays) {
    if (element.isConnected) close();
    else overlays.delete(element);
  }
});

export function closeOnEscape(element, close) {
  overlays.set(element, close);
}
