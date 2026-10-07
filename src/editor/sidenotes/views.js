function numberOf(decorations) {
  for (const decoration of decorations) {
    const number = decoration.type.attrs?.['data-number'];
    if (number !== undefined) return number;
  }
  return null;
}

export class ReferenceView {
  constructor(node, decorations) {
    this.node = node;
    this.dom = document.createElement('sup');
    this.dom.className = 'sidenote-ref';
    this.link = document.createElement('a');
    this.dom.append(this.link);
    this.render(numberOf(decorations));
  }

  render(number) {
    if (number === null) {
      this.dom.removeAttribute('id');
      this.link.removeAttribute('href');
      this.link.textContent = `[^${this.node.attrs.label}]`;
      return;
    }
    this.dom.id = `sn-ref-${number}`;
    this.link.href = `#sn-${number}`;
    this.link.textContent = number;
  }

  update(node, decorations) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render(numberOf(decorations));
    return true;
  }

  ignoreMutation(mutation) {
    return mutation.type !== 'selection';
  }
}

export class DefinitionView {
  constructor(node, decorations) {
    this.node = node;
    this.dom = document.createElement('aside');
    this.number = document.createElement('span');
    this.number.className = 'sidenote-number';
    this.number.contentEditable = 'false';
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'sidenote-body';
    this.dom.append(this.number, this.contentDOM);
    this.render(numberOf(decorations));
  }

  render(number) {
    this.dom.classList.add('sidenote');
    this.dom.classList.toggle('unnumbered', number === null);
    if (number === null) this.dom.removeAttribute('id');
    else this.dom.id = `sn-${number}`;
    this.number.textContent = number ?? '';
    this.number.hidden = number === null;
  }

  update(node, decorations) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render(numberOf(decorations));
    return true;
  }

  ignoreMutation(mutation) {
    if (mutation.type === 'selection') return false;
    if (mutation.target === this.dom && mutation.type === 'attributes') return true;
    return this.number.contains(mutation.target);
  }
}
