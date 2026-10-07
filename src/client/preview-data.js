const glyphReference = /href="#(MJX-[^"]+)"/g;

export function referencedGlyphs(html, glyphs) {
  const ids = new Set([...html.matchAll(glyphReference)].map(([, id]) => id));
  return Object.fromEntries([...ids].filter((id) => Object.hasOwn(glyphs, id)).map((id) => [id, glyphs[id]]));
}

export function previewOf(sections, id) {
  let content;
  if (id === null) content = { title: sections.title, html: sections.lede?.html ?? '', components: sections.lede?.components ?? [] };
  else if (Object.hasOwn(sections.sections, id)) content = { title: null, html: sections.sections[id].html, components: sections.sections[id].components };
  else return null;
  const scripts = Object.fromEntries(content.components.filter((name) => Object.hasOwn(sections.scripts, name)).map((name) => [name, sections.scripts[name]]));
  return { ...content, glyphs: referencedGlyphs(content.html, sections.glyphs), scripts };
}
