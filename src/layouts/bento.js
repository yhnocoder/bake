import { escapeHtml } from './html.js';

export const fields = {};

export default function bento({ page, html }) {
  return `<main class="layout-bento">
<header class="mast"><h1>${escapeHtml(page.title)}</h1></header>
<article>${html}</article>
</main>`;
}
