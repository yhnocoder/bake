export function observedAttributes(properties = {}) {
  return Object.keys(properties).map((key) => key.toLowerCase());
}
