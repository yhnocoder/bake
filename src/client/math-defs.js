const svgNamespace = 'http://www.w3.org/2000/svg';
const glyphPattern = /<path id="([^"]+)" d="([^"]*)"/g;

function container() {
  const existing = document.getElementById('math-defs');
  if (existing) return existing.querySelector('defs');
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.id = 'math-defs';
  svg.style.display = 'none';
  const defs = document.createElementNS(svgNamespace, 'defs');
  svg.append(defs);
  document.body.prepend(svg);
  return defs;
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

export function glyphsOf(mathDefs) {
  return Object.fromEntries([...mathDefs.matchAll(glyphPattern)].map(([, id, d]) => [id, d]));
}
