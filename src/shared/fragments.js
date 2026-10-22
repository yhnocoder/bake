export function sidenoteId(number) {
  return `sidenote-${number}`;
}

export function referenceId(key) {
  return `reference-${key}`;
}

export function fragmentOf(id) {
  return `#${encodeURIComponent(id)}`;
}

export function idOfFragment(hash) {
  return hash.length < 2 ? null : percentDecode(hash.slice(1));
}

export function elementOfFragment(document, hash) {
  const id = idOfFragment(hash);
  return id === null ? null : document.getElementById(id);
}

export function percentDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}
