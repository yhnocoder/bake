import { codeBlockSchema } from '@milkdown/preset-commonmark';
import { $view } from '@milkdown/utils';

class CodeBlockView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.dom = document.createElement('pre');
    this.language = document.createElement('input');
    this.language.className = 'bake-code-language';
    this.language.placeholder = '语言';
    this.language.spellcheck = false;
    this.language.value = node.attrs.language;
    this.language.addEventListener('change', () => this.setLanguage());
    this.language.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.setLanguage();
        view.focus();
      }
    });
    this.contentDOM = document.createElement('code');
    this.dom.append(this.language, this.contentDOM);
  }

  setLanguage() {
    const language = this.language.value.trim();
    if (language !== this.node.attrs.language) this.view.dispatch(this.view.state.tr.setNodeAttribute(this.getPos(), 'language', language));
  }

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    if (document.activeElement !== this.language) this.language.value = node.attrs.language;
    return true;
  }

  stopEvent(event) {
    return event.target === this.language;
  }

  ignoreMutation(mutation) {
    return mutation.type !== 'selection' && !this.contentDOM.contains(mutation.target);
  }
}

export const codeBlockView = $view(codeBlockSchema.node, () => (node, view, getPos) => new CodeBlockView(node, view, getPos));
