export const texPackages = ['base', 'ams', 'newcommand', 'configmacros'];

export function svgOptions(fontCache) {
  return { fontCache, useXlink: false, linebreaks: { inline: false } };
}
