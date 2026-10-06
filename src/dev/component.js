const callbacks = ['connectedCallback', 'disconnectedCallback', 'adoptedCallback', 'attributeChangedCallback'];

function replaceElements(name) {
  for (const old of document.querySelectorAll(name)) {
    const fresh = document.createElement(name);
    for (const { name: attribute, value } of old.attributes) fresh.setAttribute(attribute, value);
    fresh.append(...old.childNodes);
    old.replaceWith(fresh);
  }
}

export function defineComponent(name, implementation) {
  let current = implementation;
  class Host extends HTMLElement {
    static observedAttributes = Object.keys(implementation.properties ?? {}).map((key) => key.toLowerCase());

    constructor() {
      const element = Reflect.construct(current, [], Host);
      Object.setPrototypeOf(element, current.prototype);
      return element;
    }
  }
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
