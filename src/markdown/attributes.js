const BARE = `[^\\s"'={}]+`;
const ATTRIBUTE = new RegExp(`\\s*(?:#(${BARE})|\\.(${BARE})|([A-Za-z_][\\w-]*)(?:=(?:"([^"]*)"|'([^']*)'|(${BARE})))?)`, 'y');
const LEADING_SPACE = /^\s*/;

export const BARE_VALUE = new RegExp(`^${BARE}$`);

export function attributeTokens(text) {
  const inner = text.slice(1, -1);
  const tokens = [];
  ATTRIBUTE.lastIndex = 0;
  while (inner.slice(ATTRIBUTE.lastIndex).trim() !== '') {
    const start = ATTRIBUTE.lastIndex;
    const match = ATTRIBUTE.exec(inner);
    if (!match || (ATTRIBUTE.lastIndex < inner.length && !/\s/.test(inner[ATTRIBUTE.lastIndex]))) {
      return { tokens, error: `cannot read the attributes ${text}; write them as {#id key=value key="text with spaces"}` };
    }
    const [, id, className, name, double, single, bare] = match;
    const key = id !== undefined ? 'id' : className !== undefined ? 'class' : name;
    const value = id ?? className ?? double ?? single ?? bare ?? true;
    tokens.push({ key, value, start: 1 + start + LEADING_SPACE.exec(match[0])[0].length, end: 1 + ATTRIBUTE.lastIndex });
    if (ATTRIBUTE.lastIndex === start) break;
  }
  return { tokens };
}

export function parseAttributes(text) {
  const { tokens, error } = attributeTokens(text);
  const attributes = {};
  const offsets = {};
  for (const { key, value, start } of tokens) {
    if (Object.hasOwn(attributes, key)) return { error: `attribute "${key}" is written twice`, attributes, offsets };
    attributes[key] = value;
    offsets[key] = start;
  }
  return error === undefined ? { attributes, offsets } : { error, attributes, offsets };
}
