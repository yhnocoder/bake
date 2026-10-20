const TICK_STEPS = [
  [1.5, 1],
  [3.5, 2],
  [7.5, 5],
];
const EPSILON = 1e-9;
const MAX_DIGITS = 20;

export function formatNumber(value, digits) {
  const text = value.toFixed(digits);
  return (Number(text) === 0 ? text.replace('-', '') : text).replace('-', '−');
}

export function stepDigits(step) {
  for (let digits = 0; digits < MAX_DIGITS; digits++) {
    const scaled = Math.abs(step) * 10 ** digits;
    if (Math.abs(scaled - Math.round(scaled)) <= scaled * EPSILON) return digits;
  }
  return MAX_DIGITS;
}

export function niceTicks(low, high, count) {
  const raw = (high - low) / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const ratio = raw / power;
  const step = (TICK_STEPS.find(([limit]) => ratio < limit)?.[1] ?? 10) * power;
  const digits = stepDigits(step);
  const ticks = [];
  const last = Math.floor(high / step + EPSILON);
  for (let index = Math.ceil(low / step - EPSILON); index <= last; index++) {
    const value = index * step;
    ticks.push({ value, label: formatNumber(value, digits) });
  }
  return ticks;
}

export function linearScale([domainStart, domainEnd], [rangeStart, rangeEnd]) {
  const ratio = (rangeEnd - rangeStart) / (domainEnd - domainStart);
  const scale = (value) => rangeStart + (value - domainStart) * ratio;
  scale.invert = (position) => domainStart + (position - rangeStart) / ratio;
  return scale;
}

export function samplePath(f, [start, end], x, y, samples, breaks = []) {
  const step = (end - start) / samples;
  let path = '';
  let drawing = false;
  for (let index = 0; index <= samples; index++) {
    const value = start + step * index;
    const result = f(value);
    if (!Number.isFinite(result) || breaks.some((at) => value - step < at && value >= at)) {
      drawing = false;
      if (!Number.isFinite(result)) continue;
    }
    path += `${drawing ? 'L' : 'M'}${x(value).toFixed(1)} ${y(result).toFixed(1)}`;
    drawing = true;
  }
  return path;
}
