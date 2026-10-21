const DIVERGING = ['--diverge-low', '--diverge-mid', '--diverge-high'];

// The diverging colours of the theme at an element, as a function from a value between -1 and 1 to [red, green, blue].
export function divergingColors(element) {
  const style = getComputedStyle(element);
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const [low, middle, high] = DIVERGING.map((name) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = style.getPropertyValue(name);
    context.fillRect(0, 0, 1, 1);
    return context.getImageData(0, 0, 1, 1).data.slice(0, 3);
  });
  return (value) => {
    const end = value < 0 ? low : high;
    const weight = Math.min(1, Math.abs(value));
    return [0, 1, 2].map((channel) => Math.round(middle[channel] + (end[channel] - middle[channel]) * weight));
  };
}
