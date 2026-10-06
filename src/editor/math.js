import { InputRule } from '@milkdown/prose/inputrules';
import { NodeSelection, Plugin, PluginKey } from '@milkdown/prose/state';
import { $inputRule, $nodeSchema, $prose, $view } from '@milkdown/utils';
import { addGlyphs } from '../client/math-defs.js';
import { eqrefOnly, labelNames, labelPattern } from '../render/equation-labels.js';

function formulaKey(tex, display) {
  return `${display ? 'display' : 'inline'}:${tex}`;
}

export function renderedFormulas(article) {
  const formulas = new Map();
  for (const element of article.querySelectorAll('[data-tex]')) {
    formulas.set(formulaKey(element.dataset.tex, element.classList.contains('display')), element.innerHTML);
  }
  return formulas;
}

function equationNumbers(doc) {
  const numbers = new Map();
  let count = 0;
  doc.descendants((node) => {
    if (node.type.name !== 'math_block') return;
    for (const name of labelNames(node.attrs.value)) {
      count++;
      if (!numbers.has(name)) numbers.set(name, count);
    }
  });
  return numbers;
}

function createFormulaRenderer(formulas) {
  let renderTex = null;
  return {
    rendered: (tex, display) => formulas.get(formulaKey(tex, display)),
    async render(tex, display, numbers) {
      renderTex ??= (await import('../math/browser.js')).renderTex;
      const tagged = tex.replace(labelPattern, (_, name) => (numbers.has(name) ? `\\tag{${numbers.get(name)}}` : ''));
      const { svg, glyphs } = await renderTex(tagged, display);
      addGlyphs(glyphs);
      formulas.set(formulaKey(tex, display), svg);
      return svg;
    },
  };
}

const views = new WeakMap();

class MathView {
  constructor(node, view, getPos, { display, formulas }) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.display = display;
    this.formulas = formulas;
    this.dom = document.createElement(display ? 'div' : 'span');
    this.dom.className = display ? 'math display' : 'math';
    this.dom.addEventListener('click', () => this.open());
    this.show(node.attrs.value);
  }

  show(tex) {
    this.shown = tex;
    this.numbers = numbersKey.getState(this.view.state);
    this.dom.dataset.tex = tex;
    const reference = this.display ? null : eqrefOnly.exec(tex);
    if (reference) {
      this.dom.replaceChildren(Object.assign(document.createElement('a'), { className: 'eqref', textContent: `(${this.numbers.get(reference[1]) ?? '?'})` }));
      return;
    }
    const rendered = this.formulas.rendered(tex, this.display);
    if (rendered === undefined) this.renderLater(tex);
    else this.showSvg(rendered);
  }

  showSvg(svg) {
    this.dom.classList.remove('math-error');
    this.dom.innerHTML = svg;
  }

  async renderLater(tex) {
    try {
      const svg = await this.formulas.render(tex, this.display, this.numbers);
      if (this.shown === tex) this.showSvg(svg);
    } catch (error) {
      if (this.shown !== tex) return;
      this.dom.classList.add('math-error');
      this.dom.textContent = `${tex}  ${error.message}`;
    }
  }

  open() {
    if (this.input) return;
    const input = document.createElement(this.display ? 'textarea' : 'input');
    input.className = 'bake-math-input';
    input.value = this.node.attrs.value;
    input.spellcheck = false;
    const box = this.dom.getBoundingClientRect();
    Object.assign(input.style, { left: `${box.left + window.scrollX}px`, top: `${box.bottom + window.scrollY + 4}px` });
    input.addEventListener('input', () => this.show(input.value));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close(false);
      else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.close(true);
      }
    });
    input.addEventListener('blur', () => this.close(true));
    document.body.append(input);
    this.input = input;
    input.focus();
  }

  close(commit) {
    const input = this.input;
    if (!input) return;
    this.input = null;
    input.remove();
    const value = input.value;
    if (!commit || value === this.node.attrs.value) {
      this.show(this.node.attrs.value);
      this.view.focus();
      return;
    }
    const pos = this.getPos();
    const tr = this.view.state.tr.setNodeAttribute(pos, 'value', value);
    this.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
    this.view.focus();
  }

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    if (!this.input && (node.attrs.value !== this.shown || numbersKey.getState(this.view.state) !== this.numbers)) this.show(node.attrs.value);
    return true;
  }

  destroy() {
    this.input?.remove();
  }

  stopEvent() {
    return false;
  }

  ignoreMutation() {
    return true;
  }
}

function mathSchema(id, mdastType, display) {
  return $nodeSchema(id, () => ({
    group: display ? 'block' : 'inline',
    inline: !display,
    atom: true,
    attrs: { value: { default: '' } },
    parseDOM: [],
    toDOM: (node) => [display ? 'div' : 'span', { class: display ? 'math display' : 'math', 'data-tex': node.attrs.value }, node.attrs.value],
    parseMarkdown: {
      match: (node) => node.type === mdastType,
      runner: (state, node, type) => {
        state.addNode(type, { value: node.value });
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === id,
      runner: (state, node) => {
        state.addNode(mdastType, undefined, node.attrs.value);
      },
    },
  }));
}

export const mathInlineSchema = mathSchema('math_inline', 'inlineMath', false);
export const mathBlockSchema = mathSchema('math_block', 'math', true);

const mathInputRule = $inputRule(
  (ctx) =>
    new InputRule(/(?<![\\$])\$([^$\s](?:[^$]*[^$\s\\])?)\$$/, (state, match, start, end) => {
      return state.tr.replaceWith(start, end, mathInlineSchema.type(ctx).create({ value: match[1] }));
    }),
);

export function openFormulaEditor(view, pos) {
  views.get(view.nodeDOM(pos))?.open();
}

const numbersKey = new PluginKey('bake-equation-numbers');

export function reloadTransaction(tr) {
  return tr.setMeta(numbersKey, true).setMeta('addToHistory', false);
}

const loadedNumbers = $prose(
  () =>
    new Plugin({
      key: numbersKey,
      state: { init: (_, state) => equationNumbers(state.doc), apply: (tr, numbers) => (tr.getMeta(numbersKey) ? equationNumbers(tr.doc) : numbers) },
    }),
);

export function math(formulas) {
  const renderer = createFormulaRenderer(formulas);
  const create = (display) => (node, view, getPos) => {
    const mathView = new MathView(node, view, getPos, { display, formulas: renderer });
    views.set(mathView.dom, mathView);
    return mathView;
  };
  return [mathInlineSchema, mathBlockSchema, mathInputRule, loadedNumbers, $view(mathInlineSchema.node, () => create(false)), $view(mathBlockSchema.node, () => create(true))].flat();
}
