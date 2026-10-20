const SOURCE = 'script.bk-source';

let selectionModule = null;
let selectionImport = null;

export function articleSource() {
  const element = document.querySelector(SOURCE);
  return element === null ? null : JSON.parse(element.textContent);
}

export function copyArticle() {
  if (navigator.clipboard === undefined) return Promise.reject(new Error('the page has no clipboard'));
  return navigator.clipboard.writeText(articleSource());
}

export function startCopy(article, { copied }) {
  if (articleSource() === null) throw new Error('bake/copy needs the source of the article in script.bk-source');
  article.addEventListener('selectstart', loadSelection, { once: true });
  if (document.readyState === 'complete') loadWhenIdle();
  else addEventListener('load', loadWhenIdle, { once: true });
  document.addEventListener('copy', (event) => {
    if (selectionModule === null) return;
    const selection = getSelection();
    if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return;
    const result = selectionModule.copiedSelection(selection.getRangeAt(0), article, articleSource());
    if (result === null) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', result.markdown);
    event.clipboardData.setData('text/html', result.html);
    copied();
  });
}

export async function selectionMarkdown(range, article) {
  const module = await loadSelection();
  return module === null ? null : module.copiedSelection(range, article, articleSource());
}

function loadWhenIdle() {
  // why: some Safari versions have no requestIdleCallback; there the first selectstart in the article loads the selection module
  if (typeof requestIdleCallback === 'function') requestIdleCallback(loadSelection);
}

function loadSelection() {
  selectionImport ??= import('./selection.js').then(
    (module) => (selectionModule = module),
    () => null,
  );
  return selectionImport;
}
