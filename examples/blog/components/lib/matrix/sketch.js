let sketchCount = 0

const escapeText = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function attributes(attrs) {
  return Object.entries(attrs)
    .filter(([, value]) => value != null && value !== false)
    .map(([key, value]) => ` ${key}="${escapeText(value).replace(/"/g, '&quot;')}"`)
    .join('')
}

export const ink = {
  box: { fill: 'var(--surface-2)', stroke: 'var(--line-2)', rx: 6 },
  pill: { fill: 'var(--surface)', stroke: 'var(--line-2)', rx: 15 },
  edge: { fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 1.3 },
  highlight: { fill: 'var(--accent)', 'fill-opacity': 0.12, stroke: 'var(--accent)', 'stroke-width': 1.5 },
}

export class Sketch {
  constructor() {
    this.id = `matrix-sketch-${++sketchCount}`
    this.background = []
    this.shapes = []
    this.labels = []
    this.definitions = []
  }

  under(name, attrs = {}) {
    this.background.push(`<${name}${attributes(attrs)}/>`)
  }

  el(name, attrs = {}, text) {
    this.shapes.push(`<${name}${attributes(attrs)}>${text == null ? '' : escapeText(text)}</${name}>`)
  }

  text(x, y, content, style = '', anchor = 'middle') {
    this.el('text', { x, y, 'text-anchor': anchor, style: `font-family:var(--font-ui);${style}` }, content)
  }

  marker(name, color) {
    const id = `${this.id}-${name}`
    this.definitions.push(
      `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${color}"/></marker>`,
    )
    return `url(#${id})`
  }

  tex(tex, size, x, y, align = 'middle', color = '') {
    this.labels.push({ tex, size, x, y, align, color })
  }

  texOnBackground(tex, size, x, y, align = 'middle', color = '') {
    this.labels.push({ tex, size, x, y, align, color, backdrop: true })
  }

  label(text, size, x, y, align = 'middle', color = '') {
    this.labels.push({ text, size, x, y, align, color })
  }

  drawing(viewBox) {
    return {
      viewBox,
      shapes: `<defs>${this.definitions.join('')}</defs>${this.background.join('')}${this.shapes.join('')}`,
      labels: this.labels,
    }
  }
}
