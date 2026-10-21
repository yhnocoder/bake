import { copyArticle, startCopy } from 'bake/copy';
import { labelsFor } from '../labels.js';
import { showToast } from './toast.jsx';

export function startMarkdownCopy(article) {
  const labels = labelsFor(document.documentElement.lang);
  const click = (event) => {
    if (event.target.closest('.bk-copy-source') === null) return;
    copyArticle().then(
      () => showToast(labels.markdownCopied),
      () => showToast(labels.copyFailed),
    );
  };
  const stopCopy = startCopy(article, { copied: () => showToast(labels.markdownCopied) });
  document.addEventListener('click', click);
  return () => {
    stopCopy();
    document.removeEventListener('click', click);
  };
}
