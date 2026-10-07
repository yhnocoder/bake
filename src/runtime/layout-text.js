import { clearCache, layoutWithLines, prepareWithSegments } from '@chenglou/pretext';

document.fonts.addEventListener('loadingdone', () => clearCache());

export function layoutText({ text, font, width, lineHeight }) {
  const { lines } = layoutWithLines(prepareWithSegments(text, font), width, lineHeight);
  return { lines: lines.map((line) => ({ text: line.text, width: line.width })), height: lines.length * lineHeight };
}
