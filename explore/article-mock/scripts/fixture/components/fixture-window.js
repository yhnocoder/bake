const pixelRatio = window.devicePixelRatio

export const params = {}

export const layout = { width: 'body', height: 120 }

export default class FixtureWindow extends HTMLElement {
  connectedCallback() {
    this.textContent = String(pixelRatio)
  }
}
