import { labelsFor } from '../labels.js';
import { copyAddress } from './heading-links.jsx';

const ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 9.5l3-3M7 4.5l1.2-1.2a2.8 2.8 0 0 1 4 4L11 8.5M9 11.5l-1.2 1.2a2.8 2.8 0 0 1-4-4L5 7.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

// Each component of an article has a page of its own at the address in data-page, which other sites show in a frame; this link above the frame copies that address
export function startComponentLinks(article) {
  const labels = labelsFor(document.documentElement.lang);
  const links = [...article.querySelectorAll('figure.component[data-page]')].map((figure) => {
    const link = document.createElement('a');
    link.className = 'bk-component-link';
    link.href = figure.dataset.page;
    link.setAttribute('aria-label', labels.copyComponentLink);
    link.dataset.ui = '';
    link.innerHTML = ICON;
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      copyAddress(link.href, labels.componentLinkCopied);
    });
    figure.append(link);
    return link;
  });
  return () => links.forEach((link) => link.remove());
}
