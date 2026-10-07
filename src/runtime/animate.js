import { createScopedAnimate, animate as motionAnimate } from 'motion';

const skippedAnimate = createScopedAnimate({ skipAnimations: true });

export function animate(...args) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  return (reduced ? skippedAnimate : motionAnimate)(...args);
}
