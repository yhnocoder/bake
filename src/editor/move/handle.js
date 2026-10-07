import { Plugin } from '@milkdown/prose/state';
import { $prose } from '@milkdown/utils';
import { endDrag, isDragging, startDrag } from './drop.js';
import { blockRect } from './geometry.js';
import { closeMenu, openMenu } from './menu.js';
import { draggableBlocks } from './transactions.js';

const handleGap = 6;
const topAlignedTypes = new Set(['table', 'component', 'math_block', 'html', 'hr']);

function firstLine(dom) {
  const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT, {
    acceptNode: (text) => (text.data.trim() === '' || getComputedStyle(text.parentElement).position === 'absolute' ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_ACCEPT),
  });
  const text = walker.nextNode();
  if (!text) return null;
  const range = document.createRange();
  range.selectNodeContents(text);
  return [...range.getClientRects()].find((rect) => rect.height > 0) ?? null;
}

function hasImage(node) {
  let found = false;
  node.descendants((child) => {
    if (child.type.name === 'image') found = true;
    return !found;
  });
  return found;
}

function anchorTop(node, dom, rect, height) {
  const line = topAlignedTypes.has(node.type.name) || (node.type.name === 'paragraph' && hasImage(node)) ? null : firstLine(dom);
  return line ? (line.top + line.bottom) / 2 - height / 2 : rect.top;
}

class BlockHandles {
  constructor(view) {
    this.view = view;
    this.layer = document.createElement('div');
    this.layer.className = 'bake-block-handles';
    this.layer.hidden = true;
    document.body.append(this.layer);
    this.handles = [];
    this.current = null;
    this.frame = null;
    this.pointer = null;
    this.onPointerMove = (event) => {
      this.pointer = event;
      this.frame ??= requestAnimationFrame(() => {
        this.frame = null;
        this.track(this.pointer);
      });
    };
    this.hide = () => {
      if (isDragging(this.view)) return;
      this.layer.hidden = true;
      this.current = null;
    };
    document.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('resize', this.hide);
    view.dom.addEventListener('keydown', this.hide);
  }

  handle(index) {
    if (!this.handles[index]) {
      const element = document.createElement('div');
      element.className = 'bake-block-handle';
      element.draggable = true;
      element.textContent = '⋮⋮';
      element.title = '拖动以移动，点击打开块菜单';
      element.addEventListener('dragstart', (event) => {
        closeMenu();
        startDrag(this.view, Number(element.dataset.pos), event);
      });
      element.addEventListener('dragend', () => {
        endDrag(this.view);
        this.hide();
      });
      element.addEventListener('click', () => openMenu(this.view, Number(element.dataset.pos), element));
      this.layer.append(element);
      this.handles[index] = element;
    }
    return this.handles[index];
  }

  inStickyZone(event) {
    if (!this.current) return false;
    const { rect, leftmost } = this.current;
    return event.clientY >= rect.top && event.clientY <= rect.bottom && event.clientX >= leftmost && event.clientX <= rect.left;
  }

  track(event) {
    const { view } = this;
    if (!view.editable || isDragging(view) || this.layer.contains(event.target) || this.inStickyZone(event)) return;
    const article = view.dom.closest('article');
    if (!article?.contains(event.target)) {
      this.hide();
      return;
    }
    const found = view.posAtCoords({ left: event.clientX, top: event.clientY });
    const positions = found ? draggableBlocks(view.state.doc, found.inside, found.pos) : [];
    if (positions.length === 0) {
      this.hide();
      return;
    }
    this.show(positions);
  }

  show(positions) {
    const { doc } = this.view.state;
    const placed = [];
    this.layer.hidden = false;
    positions.forEach((pos, index) => {
      const element = this.handle(index);
      element.hidden = false;
      element.dataset.pos = String(pos);
      const dom = this.view.nodeDOM(pos);
      const rect = blockRect(dom);
      const width = element.offsetWidth || element.getBoundingClientRect().width;
      const height = element.offsetHeight || element.getBoundingClientRect().height;
      const top = anchorTop(doc.nodeAt(pos), dom, rect, height);
      let left = rect.left - handleGap - width;
      for (const other of placed) {
        if (top < other.top + other.height && other.top < top + height && left < other.left + width) left = other.left - width;
      }
      placed.push({ left, top, height, rect });
      Object.assign(element.style, { left: `${left + scrollX}px`, top: `${top + scrollY}px` });
    });
    for (const element of this.handles.slice(positions.length)) element.hidden = true;
    this.current = { rect: placed[0].rect, leftmost: Math.min(...placed.map((handle) => handle.left)) };
  }

  update(view, previous) {
    if (view.state.doc === previous.doc) return;
    this.hide();
    closeMenu();
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    closeMenu();
    document.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('resize', this.hide);
    this.view.dom.removeEventListener('keydown', this.hide);
    this.layer.remove();
  }
}

export const handlePlugin = $prose(() => new Plugin({ view: (view) => new BlockHandles(view) }));
