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
  const copy = (event) => {
    const selection = getSelection();
    if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return;
    if (selectionModule === null) {
      loadSelection();
      return;
    }
    const result = selectionModule.copiedSelection(selection.getRangeAt(0), article, articleSource());
    if (result === null) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', result.markdown);
    event.clipboardData.setData('text/html', result.html);
    copied();
  };
  const controller = new AbortController();
  const { signal } = controller;
  article.addEventListener('selectstart', loadSelection, { once: true, signal });
  article.addEventListener('contextmenu', loadSelection, { once: true, signal });
  document.addEventListener('keydown', loadOnShortcut, { signal });
  document.addEventListener('copy', copy, { signal });
  return () => controller.abort();
}

export async function selectionMarkdown(range, article) {
  const module = await loadSelection();
  return module === null ? null : module.copiedSelection(range, article, articleSource());
}

function loadOnShortcut(event) {
  if (!event.metaKey && !event.ctrlKey) return;
  document.removeEventListener('keydown', loadOnShortcut);
  loadSelection();
}

function loadSelection() {
  selectionImport ??= import('./selection.js').then(
    (module) => (selectionModule = module),
    () => null,
  );
  return selectionImport;
}
