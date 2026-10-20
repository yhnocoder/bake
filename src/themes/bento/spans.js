export function levelSpan(level, columns) {
  const body = Math.max(1, Math.round(columns / 3));
  if (level === 'page') return columns;
  if (level === 'wide') return Math.min(columns, Math.max(Math.ceil(columns / 2), body + 1));
  return body;
}
