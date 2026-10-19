import { createEffect, createSignal, on, onCleanup } from 'solid-js';

export function createTween(target, duration) {
  const [value, setValue] = createSignal(target());
  let frame = 0;
  createEffect(
    on(
      target,
      (to) => {
        cancelAnimationFrame(frame);
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return setValue(to);
        const from = value();
        const start = performance.now();
        const step = (now) => {
          const progress = Math.min(1, (now - start) / duration);
          const eased = 1 - (1 - progress) ** 3;
          setValue(from.map((origin, index) => origin + (to[index] - origin) * eased));
          if (progress < 1) frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
      },
      { defer: true },
    ),
  );
  onCleanup(() => cancelAnimationFrame(frame));
  return value;
}
