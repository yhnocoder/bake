import { addGlyphs, glyphsOf } from '../client/math-defs.js';
import { tocList } from '../layouts/html.js';
import { showStatus } from './status.js';

function stylesheets(target) {
  return [...target.querySelectorAll('link[rel="stylesheet"]')];
}

function copyClass(from, to) {
  if (from.hasAttribute('class')) to.setAttribute('class', from.getAttribute('class'));
  else to.removeAttribute('class');
}

export function replaceChrome(nextDocument) {
  document.title = nextDocument.title;
  const nextHrefs = new Set(stylesheets(nextDocument).map((link) => link.getAttribute('href')));
  const currentHrefs = new Set(stylesheets(document).map((link) => link.getAttribute('href')));
  for (const link of stylesheets(document)) if (!nextHrefs.has(link.getAttribute('href'))) link.remove();
  for (const link of stylesheets(nextDocument)) if (!currentHrefs.has(link.getAttribute('href'))) document.head.append(document.importNode(link));
  copyClass(nextDocument.body, document.body);
  const article = document.querySelector('article');
  const nextArticle = nextDocument.querySelector('article');
  copyClass(nextArticle, article);
  nextArticle.replaceWith(document.createElement('article'));
  const kept = [...document.body.children].filter((element) => element.id === 'math-defs' || element.hasAttribute('data-bake-dev'));
  const nodes = [...nextDocument.body.childNodes].filter((node) => node.id !== 'math-defs').map((node) => document.importNode(node, true));
  const placeholder = nodes.map((node) => (node.matches?.('article') ? node : node.querySelector?.('article'))).find(Boolean);
  placeholder.replaceWith(article);
  document.body.replaceChildren(...kept.filter((element) => element.id === 'math-defs'), ...nodes, ...kept.filter((element) => element.id !== 'math-defs'));
  addGlyphs(glyphsOf(nextDocument.getElementById('math-defs')?.outerHTML ?? ''));
}

async function fetchDocument() {
  const response = await fetch(location.pathname);
  return new DOMParser().parseFromString(await response.text(), 'text/html');
}

let status = JSON.parse(document.getElementById('bake-status').textContent);
showStatus(status);

function updateStatus(next) {
  status = { ...status, ...next };
  showStatus(status);
}

async function update(detail) {
  updateStatus({ errors: detail.errors });
  const scroll = window.scrollY;
  const accepted = window.dispatchEvent(new CustomEvent('bake:page-update', { detail, cancelable: true }));
  if (detail.chrome) replaceChrome(await fetchDocument());
  if (accepted) {
    document.querySelector('article').innerHTML = detail.html;
    const toc = document.querySelector('nav.toc ol');
    if (toc) toc.outerHTML = tocList(detail.toc);
    addGlyphs(glyphsOf(detail.mathDefs));
  }
  window.scrollTo(window.scrollX, scroll);
  window.dispatchEvent(new CustomEvent('bake:page-updated', { detail }));
}

if (import.meta.hot) {
  import.meta.hot.send('bake:open', { url: location.pathname });
  let updating = Promise.resolve();
  import.meta.hot.on('bake:page', (detail) => {
    if (detail.url === location.pathname) updating = updating.then(() => update(detail));
  });
  import.meta.hot.on('bake:status', ({ url, errors, links }) => {
    if (url === location.pathname) updateStatus({ errors, links });
  });
}
