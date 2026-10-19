import { createSignal, onCleanup, onMount } from 'solid-js';

export function createElementSize(element) {
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  onMount(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) }));
    observer.observe(element());
    onCleanup(() => observer.disconnect());
  });
  return size;
}
