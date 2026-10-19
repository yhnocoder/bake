export const params = {
  cells: { label: '格子数', type: 'number', min: 4, max: 40, step: 1, default: 12 },
}

export const layout = { width: 'body', height: { ratio: 3 }, frame: false }

export default class FixtureGrid extends HTMLElement {
  connectedCallback() {
    this.canvas = document.createElement('canvas')
    this.canvas.style.width = '100%'
    this.canvas.style.height = '100%'
    this.canvas.style.display = 'block'
    this.style.display = 'block'
    this.style.height = '100%'
    this.style.minHeight = '120px'
    this.append(this.canvas)
    this.onTheme = () => this.update()
    document.addEventListener('bake:theme', this.onTheme)
    this.update()
  }

  disconnectedCallback() {
    document.removeEventListener('bake:theme', this.onTheme)
  }

  update() {
    const style = getComputedStyle(this)
    const low = style.getPropertyValue('--diverge-low')
    const high = style.getPropertyValue('--diverge-high')
    const ratio = devicePixelRatio
    const { width, height } = this.canvas.getBoundingClientRect()
    this.canvas.width = width * ratio
    this.canvas.height = height * ratio
    const context = this.canvas.getContext('2d')
    const n = this.params.cells
    const size = this.canvas.width / n
    const rows = Math.ceil(this.canvas.height / size)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < rows; j++) {
        context.globalAlpha = 0.25 + 0.75 * Math.abs(Math.sin(i * 0.7 + j * 0.4))
        context.fillStyle = (i + j) % 2 ? low : high
        context.fillRect(i * size, j * size, size - ratio, size - ratio)
      }
    }
  }
}
