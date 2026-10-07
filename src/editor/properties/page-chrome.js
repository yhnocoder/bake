import { Plugin } from '@milkdown/prose/state';
import { $prose } from '@milkdown/utils';
import { replaceChrome } from '../../dev/client.js';
import { readPage, writeTitle } from './frontmatter.js';

const titleSelector = 'header.mast > h1';

function titleHeading() {
  return document.querySelector(titleSelector);
}

class PageChromeView {
  constructor(view) {
    this.view = view;
    this.saved = view.state.doc.attrs.frontmatter;
    this.refreshing = Promise.resolve();
    this.onKeyDown = (event) => this.keyDown(event);
    this.onFocusOut = (event) => {
      if (event.target.matches?.(titleSelector)) this.commit(event.target);
    };
    this.onSaved = (event) => {
      this.refreshing = this.refreshing.then(() => this.refresh(event.detail));
    };
    this.onPageUpdated = () => this.enable();
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('focusout', this.onFocusOut);
    window.addEventListener('bake:editor-saved', this.onSaved);
    window.addEventListener('bake:page-updated', this.onPageUpdated);
    this.enable();
  }

  title() {
    const title = readPage(this.view.state.doc.attrs.frontmatter).values?.title;
    return title === undefined || title === null ? '' : String(title);
  }

  enable() {
    const heading = titleHeading();
    if (!heading) return;
    heading.setAttribute('contenteditable', 'plaintext-only');
    if (document.activeElement !== heading) heading.textContent = this.title();
  }

  keyDown(event) {
    const heading = event.target;
    if (!heading.matches?.(titleSelector)) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      this.commit(heading);
      this.view.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      heading.textContent = this.title();
      this.view.focus();
    }
  }

  commit(heading) {
    const text = heading.textContent.trim();
    if (text !== '' && text !== this.title()) writeTitle(this.view, text);
    heading.textContent = this.title();
  }

  async refresh({ url, frontmatter }) {
    if (frontmatter === this.saved) return;
    this.saved = frontmatter;
    const response = await fetch(url);
    const next = new DOMParser().parseFromString(await response.text(), 'text/html');
    const scroll = window.scrollY;
    const editorFocused = this.view.hasFocus();
    const focused = document.activeElement;
    replaceChrome(next);
    if (editorFocused) this.view.focus();
    else if (focused?.isConnected && focused !== document.body) focused.focus({ preventScroll: true });
    window.scrollTo(window.scrollX, scroll);
    window.dispatchEvent(new CustomEvent('bake:page-updated', { detail: {} }));
  }

  update(view, previous) {
    this.view = view;
    if (view.state.doc.attrs.frontmatter === previous.doc.attrs.frontmatter) return;
    const heading = titleHeading();
    if (heading && document.activeElement !== heading) heading.textContent = this.title();
  }

  destroy() {
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('focusout', this.onFocusOut);
    window.removeEventListener('bake:editor-saved', this.onSaved);
    window.removeEventListener('bake:page-updated', this.onPageUpdated);
    titleHeading()?.removeAttribute('contenteditable');
  }
}

export const pageChrome = $prose(() => new Plugin({ view: (view) => new PageChromeView(view) }));
