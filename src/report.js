export function errorAt(file, position, message) {
  return { file, line: position.line, column: position.column, message };
}

export const fileStart = Object.freeze({ line: 1, column: 1 });

export function formatError({ file, line, column, message }) {
  return `${file}:${line}:${column} ${message}`;
}

export function sortErrors(errors) {
  return errors.toSorted((a, b) => compareText(a.file, b.file) || a.line - b.line || a.column - b.column);
}

export function errorCountLine(count) {
  return `${count} ${count === 1 ? 'error' : 'errors'}, dist/ was not written`;
}

export function describeValue(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null) return 'an empty value';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'function') return 'a function';
  if (typeof value === 'object') return 'an object';
  return String(value);
}

export function listChoices(choices) {
  return choices.length === 1 ? choices[0] : `${choices.slice(0, -1).join(', ')} or ${choices.at(-1)}`;
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
