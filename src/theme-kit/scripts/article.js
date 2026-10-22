import { startMarkdownCopy } from './copy.js';
import { startFolds } from './folds.js';
import { startHeadingLinks } from './heading-links.jsx';
import { startPreviewCard } from './preview-card.jsx';
import { startSidenoteHighlight } from './sidenotes.js';
import { startToast } from './toast.jsx';

export function startArticle(article, { onSidenote } = {}) {
  const stops = [startToast(), startFolds(article), startSidenoteHighlight(article, onSidenote), startHeadingLinks(), startMarkdownCopy(article), startPreviewCard(article)];
  return () => stops.forEach((stop) => stop());
}
