export const labelPattern = /\\label\{([^}]*)\}/g;
export const eqrefOnly = /^\s*\\eqref\{([^}]*)\}\s*$/;

export function labelNames(tex) {
  return [...tex.matchAll(labelPattern)].map((match) => match[1]);
}

export function equationId(name) {
  return name.replaceAll(':', '-');
}
