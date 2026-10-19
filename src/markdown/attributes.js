const ATTRIBUTE = /\s*(?:#([^\s"'={}]+)|\.([^\s"'={}]+)|([A-Za-z_][\w-]*)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"'={}]+)))?)/y;

export function parseAttributes(text) {
  const inner = text.slice(1, -1);
  const attributes = {};
  ATTRIBUTE.lastIndex = 0;
  while (inner.slice(ATTRIBUTE.lastIndex).trim() !== '') {
    const start = ATTRIBUTE.lastIndex;
    const match = ATTRIBUTE.exec(inner);
    if (!match || (ATTRIBUTE.lastIndex < inner.length && !/\s/.test(inner[ATTRIBUTE.lastIndex]))) {
      return { error: `cannot read the attributes ${text}; write them as {#id key=value key="text with spaces"}`, attributes };
    }
    const [, id, className, name, double, single, bare] = match;
    const key = id !== undefined ? 'id' : className !== undefined ? 'class' : name;
    const value = id ?? className ?? double ?? single ?? bare ?? true;
    if (Object.hasOwn(attributes, key)) return { error: `attribute "${key}" is written twice`, attributes };
    attributes[key] = value;
    if (ATTRIBUTE.lastIndex === start) break;
  }
  return { attributes };
}
