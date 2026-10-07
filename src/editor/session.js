import { parserCtx } from '@milkdown/core';
import { TextSelection } from '@milkdown/prose/state';
import registry from 'virtual:bake/registry';
import { addGlyphs, glyphsOf } from '../client/math-defs.js';
import { createEditor } from './editor.js';
import { docToMarkdown } from './markdown.js';
import { reloadTransaction, renderedFormulas } from './math.js';
import { trailingParagraphTransaction } from './trailing-paragraph.js';

const saveDelay = 800;

async function requestJson(url, options) {
  const response = await fetch(url, options);
  return { status: response.status, body: await response.json() };
}

function blockIndex(doc, pos) {
  return doc.resolve(Math.min(pos, doc.content.size)).index(0);
}

function startOfBlock(doc, index) {
  let pos = 0;
  for (let child = 0; child < Math.min(index, doc.childCount - 1); child++) pos += doc.child(child).nodeSize;
  return pos;
}

export async function openEditor(status) {
  let page = location.pathname;
  const article = document.querySelector('article');
  const source = await requestJson(`/__bake/source?page=${encodeURIComponent(page)}`);
  if (source.status !== 200) {
    status.failed(source.body.error);
    return null;
  }
  const formulas = renderedFormulas(article);
  let hash = source.body.hash;
  let savedDoc = null;
  let view = null;
  let timer = null;
  let saving = Promise.resolve();
  let conflict = false;

  const root = document.createElement('div');
  let created;
  try {
    created = await createEditor({ root, markdown: source.body.markdown, registry, formulas, onChange: (state) => savedDoc !== null && state.doc !== savedDoc && scheduleSave() });
  } catch {
    status.structureError();
    return null;
  }
  const { editor } = created;
  view = created.view;
  const trailing = trailingParagraphTransaction(view.state);
  if (trailing) view.dispatch(trailing.setMeta('addToHistory', false));
  savedDoc = view.state.doc;
  article.replaceChildren(...root.childNodes);
  status.saved();

  const markdown = () => editor.action((ctx) => docToMarkdown(ctx, view.state.doc));
  const hasUnsavedChanges = () => view.state.doc !== savedDoc;

  function load(markdownText, nextHash) {
    const index = blockIndex(view.state.doc, view.state.selection.from);
    let doc;
    try {
      doc = editor.action((ctx) => ctx.get(parserCtx)(markdownText));
    } catch {
      status.structureError();
      return;
    }
    hash = nextHash;
    const tr = view.state.tr.setDocAttribute('frontmatter', doc.attrs.frontmatter).replaceWith(0, view.state.doc.content.size, doc.content);
    tr.setSelection(TextSelection.near(tr.doc.resolve(startOfBlock(tr.doc, index) + 1)));
    savedDoc = null;
    view.dispatch(reloadTransaction(tr));
    savedDoc = view.state.doc;
    conflict = false;
    status.saved();
  }

  function showConflict(disk) {
    conflict = true;
    clearTimeout(timer);
    status.conflict({
      useDisk: () => load(disk.markdown, disk.hash),
      keepMine: () => {
        hash = disk.hash;
        conflict = false;
        save();
      },
    });
  }

  async function write() {
    const doc = view.state.doc;
    status.saving();
    let response;
    try {
      response = await requestJson('/__bake/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ page, markdown: markdown(), hash }),
      });
    } catch (error) {
      status.failed(error.message);
      return;
    }
    if (response.status === 200) {
      hash = response.body.hash;
      savedDoc = doc;
      if (response.body.url !== page) {
        page = response.body.url;
        history.replaceState(history.state, '', page);
      }
      window.dispatchEvent(new CustomEvent('bake:editor-saved', { detail: { url: page, hash, frontmatter: doc.attrs.frontmatter } }));
      if (hasUnsavedChanges()) scheduleSave();
      else status.saved();
    } else if (response.status === 409) showConflict(response.body);
    else status.failed(response.body.error);
  }

  function save() {
    clearTimeout(timer);
    timer = null;
    saving = saving.then(write);
    return saving;
  }

  function scheduleSave() {
    if (conflict) return;
    clearTimeout(timer);
    timer = setTimeout(save, saveDelay);
  }

  function onPageUpdate(event) {
    event.preventDefault();
    for (const [key, svg] of renderedFormulas(new DOMParser().parseFromString(`<article>${event.detail.html}</article>`, 'text/html').body)) formulas.set(key, svg);
    addGlyphs(glyphsOf(event.detail.mathDefs));
    saving.then(async () => {
      const disk = await requestJson(`/__bake/source?page=${encodeURIComponent(page)}`);
      if (disk.status !== 200 || disk.body.hash === hash) return;
      if (hasUnsavedChanges() || timer !== null) showConflict(disk.body);
      else load(disk.body.markdown, disk.body.hash);
    });
  }
  window.addEventListener('bake:page-update', onPageUpdate);

  return {
    view,
    markdown,
    async close() {
      window.removeEventListener('bake:page-update', onPageUpdate);
      if (timer !== null) save();
      await saving;
      const response = await fetch(page);
      const next = new DOMParser().parseFromString(await response.text(), 'text/html');
      editor.destroy();
      article.innerHTML = next.querySelector('article').innerHTML;
      addGlyphs(glyphsOf(next.getElementById('math-defs')?.outerHTML ?? ''));
      status.closed();
      window.dispatchEvent(new CustomEvent('bake:page-updated', { detail: { html: article.innerHTML } }));
    },
  };
}
