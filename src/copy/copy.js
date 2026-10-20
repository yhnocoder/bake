const SOURCE = 'script.bk-source';

let selectionModule = null;
let selectionImport = null;
let selectionFailed = false;

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
  article.addEventListener('contextmenu', loadSelection, { once: true });
  document.addEventListener('keydown', loadOnShortcut);
  document.addEventListener('copy', (event) => {
    const selection = getSelection();
    if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (selectionModule !== null) {
      const result = selectionModule.copiedSelection(range, article, articleSource());
      if (result === null) return;
      event.preventDefault();
      event.clipboardData.setData('text/plain', result.markdown);
      event.clipboardData.setData('text/html', result.html);
      copied();
      return;
    }
    if (selectionFailed || !range.intersectsNode(article) || navigator.clipboard?.write === undefined || typeof ClipboardItem !== 'function') return;
    event.preventDefault();
    const text = selection.toString();
    writeWhenLoaded(range.cloneRange(), article)
      .then(copied, () => navigator.clipboard.writeText(text))
      .catch(() => {});
  });
}

export async function selectionMarkdown(range, article) {
  const module = await loadSelection();
  return module === null ? null : module.copiedSelection(range, article, articleSource());
}

function writeWhenLoaded(range, article) {
  const written = loadSelection().then((module) => {
    const result = module?.copiedSelection(range, article, articleSource()) ?? null;
    if (result === null) throw new Error('the selection has no Markdown to copy');
    return result;
  });
  const blob = (type, field) => written.then((result) => new Blob([result[field]], { type }));
  return navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob('text/plain', 'markdown'), 'text/html': blob('text/html', 'html') })]);
}

function loadOnShortcut(event) {
  if (!event.metaKey && !event.ctrlKey) return;
  document.removeEventListener('keydown', loadOnShortcut);
  loadSelection();
}

function loadSelection() {
  selectionImport ??= import('./selection.js').then(
    (module) => (selectionModule = module),
    () => {
      selectionFailed = true;
      return null;
    },
  );
  return selectionImport;
}
