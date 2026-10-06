import { observedAttributes } from '../client/component.js';

const callbacks = ['disconnectedCallback', 'adoptedCallback', 'attributeChangedCallback'];
const originalChildren = new WeakMap();

function replaceElements(name) {
  for (const old of document.querySelectorAll(name)) {
    const fresh = document.createElement(name);
    for (const { name: attribute, value } of old.attributes) fresh.setAttribute(attribute, value);
    fresh.append(...(originalChildren.get(old) ?? []).map((node) => node.cloneNode(true)));
    old.replaceWith(fresh);
  }
}

export function defineComponent(name, implementation) {
  let current = implementation;
  class Host extends HTMLElement {
    static observedAttributes = observedAttributes(implementation.properties);

    constructor() {
      const element = Reflect.construct(current, [], Host);
      Object.setPrototypeOf(element, current.prototype);
      return element;
    }
  }
  Host.prototype.connectedCallback = function () {
    if (!originalChildren.has(this)) originalChildren.set(this, [...this.childNodes].map((node) => node.cloneNode(true)));
    return Object.getPrototypeOf(this).connectedCallback?.call(this);
  };
  for (const callback of callbacks) {
    Host.prototype[callback] = function (...args) {
      return Object.getPrototypeOf(this)[callback]?.apply(this, args);
    };
  }
  customElements.define(name, Host);
  return (next) => {
    current = next;
    replaceElements(name);
  };
}
