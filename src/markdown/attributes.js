const BARE = `[^\\s"'={}]+`;
const ATTRIBUTE = new RegExp(`\\s*(?:#(${BARE})|\\.(${BARE})|([A-Za-z_][\\w-]*)(?:=(?:"([^"]*)"|'([^']*)'|(${BARE})))?)`, 'y');
const LEADING_SPACE = /^\s*/;
const SHORTHAND_VALUE = new RegExp(`^${BARE}$`);
const SHORTHANDS = { id: '#', class: '.' };

export const BARE_VALUE = /^[\w.%/-]+$/;

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

export function writeAttributes(attributes) {
  const entries = Object.entries(attributes);
  if (entries.length === 0) return '';
  return `{${entries.map(([name, value]) => writeAttribute(name, value)).join(' ')}}`;
}

function writeAttribute(name, value) {
  if (value === true) return name;
  const text = String(value);
  if (Object.hasOwn(SHORTHANDS, name) && SHORTHAND_VALUE.test(text)) return `${SHORTHANDS[name]}${text}`;
  if (BARE_VALUE.test(text)) return `${name}=${text}`;
  return text.includes('"') ? `${name}='${text}'` : `${name}="${text}"`;
}
