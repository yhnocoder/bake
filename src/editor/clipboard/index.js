import { parserCtx, remarkCtx } from '@milkdown/core';
import { Fragment, Slice } from '@milkdown/prose/model';
import { Plugin, TextSelection } from '@milkdown/prose/state';
import { $prose } from '@milkdown/utils';
import { toMarkdown } from 'mdast-util-to-markdown';
import { toClipboardHtml } from '../../client/copy-markdown.js';
import { showMessage } from '../../dev/status.js';
import { markdownOptions, toMarkdownExtensions } from '../../format/to-markdown.js';
import { documentIds, dropDuplicateIds } from '../ids.js';
import { htmlToMdast } from './html.js';
import { imageExtensions, saveAndInsertImages, savingKey, savingState } from './images.js';
import { sliceToMarkdown } from './slice.js';

const blockTypes = new Set(['heading', 'list', 'table', 'math']);
const fenceMarkers = new Set(['`', '~']);

function parseMarkdownText(ctx, text) {
  const remark = ctx.get(remarkCtx);
  return remark.runSync(remark.parse(text), text);
}

function hasBlockSyntax(tree, text) {
  let found = false;
  const visit = (node) => {
    if (blockTypes.has(node.type) || (node.type === 'code' && fenceMarkers.has(text[node.position?.start.offset]))) found = true;
    node.children?.forEach(visit);
  };
  visit(tree);
  return found;
}

function isSvgSource(text) {
  const source = text.trim();
  if (!source.startsWith('<svg')) return false;
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
  return parsed.getElementsByTagName('parsererror').length === 0;
}

function imageFiles(data) {
  return [...data.files].filter((file) => imageExtensions[file.type]).map((file) => ({ blob: file, ext: imageExtensions[file.type] }));
}

function htmlHasOnlyImages(html) {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  for (const image of body.querySelectorAll('img')) image.remove();
  return body.textContent.trim() === '';
}

function vscodeMode(data) {
  const editorData = data.getData('vscode-editor-data');
  if (!editorData) return null;
  try {
    return JSON.parse(editorData).mode ?? null;
  } catch {
    return null;
  }
}

function insertAsPlainText(view, text, tr) {
  const { paragraph } = view.state.schema.nodes;
  const lines = text.split(/(?:\r\n?|\n)+/).filter((line) => line !== '');
  if (lines.length > 0) {
    const content = Fragment.from(lines.map((line) => paragraph.create(null, view.state.schema.text(line))));
    view.dispatch(tr.replaceSelection(Slice.maxOpen(content, false)).scrollIntoView());
  }
  showMessage('粘贴的内容不符合结构规则，已按纯文本插入');
}

function insertMdast(ctx, view, tree, text, tr) {
  const children = tree.children.filter((node) => node.type !== 'yaml');
  const markdown = toMarkdown({ ...tree, children }, { ...markdownOptions, extensions: toMarkdownExtensions });
  let doc;
  try {
    doc = ctx.get(parserCtx)(markdown);
  } catch {
    insertAsPlainText(view, text, tr);
    return;
  }
  const content = dropDuplicateIds(doc.content, documentIds(view.state.doc));
  view.dispatch(tr.replaceSelection(Slice.maxOpen(content, false)).scrollIntoView());
}

function classify(ctx, data) {
  const html = data.getData('text/html');
  const text = data.getData('text/plain');
  const images = imageFiles(data);
  if (images.length > 0 && (!html || htmlHasOnlyImages(html))) return { images };
  if (html && new DOMParser().parseFromString(html, 'text/html').body.querySelector(':scope > [data-bake-markdown]')) return { tree: parseMarkdownText(ctx, text), text };
  if (isSvgSource(text)) return { images: [{ blob: new Blob([text.trim()], { type: 'image/svg+xml' }), ext: 'svg' }] };
  const mode = vscodeMode(data);
  if (mode !== null && mode !== 'markdown') {
    if (mode === 'plaintext') return null;
    return { tree: { type: 'root', children: [{ type: 'code', lang: mode, value: text.replace(/\n+$/, '') }] }, text };
  }
  if (html && mode === null) return { tree: htmlToMdast(html), text };
  const tree = parseMarkdownText(ctx, text);
  return hasBlockSyntax(tree, text) ? { tree, text } : null;
}

function insertData(ctx, view, data, tr, pos) {
  const result = classify(ctx, data);
  if (!result) return false;
  if (result.images) saveAndInsertImages(view, pos, result.images);
  else insertMdast(ctx, view, result.tree, result.text, tr);
  return true;
}

export const clipboard = $prose((ctx) => {
  let plainPaste = false;

  function writeClipboard(view, event) {
    if (view.state.selection.empty) return false;
    const { dom, text } = view.serializeForClipboard(view.state.selection.content());
    event.clipboardData.clearData();
    event.clipboardData.setData('text/plain', text);
    event.clipboardData.setData('text/html', toClipboardHtml(dom));
    event.preventDefault();
    if (event.type === 'cut') view.dispatch(view.state.tr.deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'));
    return true;
  }

  return new Plugin({
    key: savingKey,
    state: savingState,
    props: {
      decorations: (state) => savingKey.getState(state),
      clipboardTextSerializer: (slice, view) => sliceToMarkdown(ctx, slice, view.state.schema),
      handleKeyDown(_, event) {
        plainPaste = (event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'v';
        return false;
      },
      handlePaste(view, event) {
        const plain = plainPaste;
        plainPaste = false;
        if (view.state.selection.$from.parent.type.spec.code || plain || !event.clipboardData) return false;
        return insertData(ctx, view, event.clipboardData, view.state.tr, view.state.selection.from);
      },
      handleDrop(view, event) {
        if (view.dragging || !event.dataTransfer) return false;
        const target = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!target) return false;
        const tr = view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(target.pos)));
        const handled = insertData(ctx, view, event.dataTransfer, tr, target.pos);
        if (handled) event.preventDefault();
        return handled;
      },
      handleDOMEvents: {
        copy: writeClipboard,
        cut: writeClipboard,
      },
    },
  });
});
