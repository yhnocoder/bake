const svgNamespace = 'http://www.w3.org/2000/svg';
const pathPattern = /<path id="([^"]+)" d="([^"]*)"/g;

export function glyphsOf(mathDefs) {
  return Object.fromEntries([...mathDefs.matchAll(pathPattern)].map(([, id, d]) => [id, d]));
}

function container() {
  let element = document.getElementById('math-defs');
  if (!element) {
    element = document.createElementNS(svgNamespace, 'svg');
    element.id = 'math-defs';
    element.style.display = 'none';
    element.append(document.createElementNS(svgNamespace, 'defs'));
    document.body.prepend(element);
  }
  return element.querySelector('defs');
}

export function addGlyphs(glyphs) {
  const defs = container();
  for (const [id, d] of Object.entries(glyphs)) {
    if (document.getElementById(id)) continue;
    const path = document.createElementNS(svgNamespace, 'path');
    path.id = id;
    path.setAttribute('d', d);
    defs.append(path);
  }
}
