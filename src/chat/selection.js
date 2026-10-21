export function selectedRange(article) {
  const selection = getSelection();
  if (article === null || selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!range.intersectsNode(article) || range.toString().trim() === '') return null;
  return range;
}
