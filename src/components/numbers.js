const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const SEPARATOR = /\s*,\s*/;

// The value of a numbers parameter as an article writes it, such as "2, 1, 0.5"; null when an item is not a number.
export function readNumbers(text) {
  const items = text.trim() === '' ? [] : text.trim().split(SEPARATOR);
  return items.every((item) => NUMBER.test(item)) ? items.map(Number) : null;
}

export function writeNumbers(numbers) {
  return numbers.join(', ');
}

export function sameValue(a, b) {
  return Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((item, index) => item === b[index]) : a === b;
}
