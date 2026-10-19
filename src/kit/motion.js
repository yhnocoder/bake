import { createEffect, createSignal, on, onCleanup } from 'solid-js';

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const easeOut = (progress) => 1 - (1 - progress) ** 3;
const interpolate = (from, to, progress) => (Array.isArray(to) ? to.map((value, index) => from[index] + (value - from[index]) * progress) : from + (to - from) * progress);

export function createTween(target, { duration = 200 } = {}) {
  const [value, setValue] = createSignal(target());
  let frame = 0;
  createEffect(
    on(
      target,
      (to) => {
        cancelAnimationFrame(frame);
        if (prefersReducedMotion()) return setValue(() => to);
        const from = value();
        const start = performance.now();
        const step = (now) => {
          const progress = Math.min(1, (now - start) / duration);
          setValue(() => interpolate(from, to, easeOut(progress)));
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
