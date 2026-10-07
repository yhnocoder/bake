import { Fragment, Slice } from '@milkdown/prose/model';
import { PluginKey } from '@milkdown/prose/state';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import { showMessage } from '../../dev/status.js';

export const imageExtensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg' };

export const savingKey = new PluginKey('bake-image-saving');
let nextId = 0;

function readBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(',') + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function saveImage(blob, ext) {
  const response = await fetch('/__bake/asset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ page: location.pathname, data: await readBase64(blob), ext }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error);
  return body.path;
}

function savingWidget() {
  const widget = document.createElement('span');
  widget.className = 'bake-image-saving';
  widget.textContent = '图片保存中…';
  return widget;
}

function placeholderPos(state, id) {
  return savingKey.getState(state).find(undefined, undefined, (spec) => spec.id === id)[0]?.from;
}

function insertRange(doc, pos) {
  const $pos = doc.resolve(pos);
  for (let depth = 1; depth <= $pos.depth; depth++) {
    if ($pos.node(depth).type.name === 'table') {
      const after = $pos.after(depth);
      return { from: after, to: after };
    }
  }
  if ($pos.parent.isTextblock && $pos.depth > 0) {
    if ($pos.parent.content.size === 0) return { from: $pos.before(), to: $pos.after() };
    if ($pos.parentOffset === 0) return { from: $pos.before(), to: $pos.before() };
    if ($pos.parentOffset === $pos.parent.content.size) return { from: $pos.after(), to: $pos.after() };
  }
  return { from: pos, to: pos };
}

function insertImages(view, pos, paths) {
  const { schema, doc } = view.state;
  const paragraphs = paths.map((src) => schema.nodes.paragraph.create(null, schema.nodes.image.create({ src, alt: '' })));
  const { from, to } = insertRange(doc, pos);
  return view.state.tr.replace(from, to, new Slice(Fragment.from(paragraphs), 0, 0));
}

export async function saveAndInsertImages(view, pos, images) {
  const id = ++nextId;
  view.dispatch(view.state.tr.setMeta(savingKey, { add: { id, pos } }));
  const paths = [];
  let failure = null;
  for (const { blob, ext } of images) {
    try {
      paths.push(await saveImage(blob, ext));
    } catch (error) {
      failure = error;
    }
  }
  const at = placeholderPos(view.state, id);
  const tr = paths.length > 0 && at !== undefined ? insertImages(view, at, paths) : view.state.tr;
  view.dispatch(tr.setMeta(savingKey, { remove: id }));
  if (failure) showMessage(`图片保存失败：${failure.message}`);
}

export const savingState = {
  init: () => DecorationSet.empty,
  apply(tr, decorations) {
    let next = decorations.map(tr.mapping, tr.doc);
    const meta = tr.getMeta(savingKey);
    if (meta?.add) next = next.add(tr.doc, [Decoration.widget(meta.add.pos, savingWidget, { id: meta.add.id, side: -1 })]);
    if (meta?.remove) next = next.remove(next.find(undefined, undefined, (spec) => spec.id === meta.remove));
    return next;
  },
};
