import { createStore, reconcile } from 'solid-js/store';
import { createComponent, render } from 'solid-js/web';

export function solidElement(Component) {
  return class extends HTMLElement {
    #setParams = null;
    #dispose = null;

    connectedCallback() {
      if (this.#dispose !== null) return;
      const [params, setParams] = createStore({ ...this.params });
      this.#setParams = setParams;
      this.#dispose = render(() => createComponent(Component, params), this);
    }

    disconnectedCallback() {
      this.#dispose?.();
      this.#dispose = null;
      this.#setParams = null;
    }

    update() {
      this.#setParams?.(reconcile({ ...this.params }));
    }
  };
}
