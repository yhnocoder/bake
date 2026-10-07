import { codeBlockSchema } from '@milkdown/preset-commonmark';
import { $view } from '@milkdown/utils';

function markUnknownLanguage(element, decorations) {
  const unknown = decorations.some((decoration) => decoration.spec.unknownLanguage);
  element.classList.toggle('unknown-language', unknown);
  if (unknown) element.title = '未知的语言名，构建时会报错';
  else element.removeAttribute('title');
}

class CodeBlockView {
  constructor(node, view, getPos, decorations) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.dom = document.createElement('pre');
    this.language = document.createElement('input');
    this.language.className = 'bake-code-language';
    this.language.placeholder = '语言';
    this.language.spellcheck = false;
    this.language.value = node.attrs.language;
    markUnknownLanguage(this.language, decorations);
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

  update(node, decorations) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    markUnknownLanguage(this.language, decorations);
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

export const codeBlockView = $view(codeBlockSchema.node, () => (node, view, getPos, decorations) => new CodeBlockView(node, view, getPos, decorations));
