export const formatNumber = (value, digits) => value.toFixed(digits).replace('-', '−');

export function niceTicks(low, high, count) {
  const raw = (high - low) / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const ratio = raw / power;
  const step = (ratio < 1.5 ? 1 : ratio < 3.5 ? 2 : ratio < 7.5 ? 5 : 10) * power;
  const digits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const ticks = [];
  for (let index = Math.ceil(low / step - 1e-9); index * step <= high + 1e-9; index++) {
    const value = index * step;
    ticks.push({ value, label: formatNumber(Math.abs(value) < step / 2 ? 0 : value, digits) });
  }
  return ticks;
}
