export const REGIONS = { article: 'article', toc: 'toc', source: 'source', glyphs: 'glyphs', previews: 'previews', words: 'words' };

export function regionSelector(name) {
  return `[data-region="${name}"]`;
}
