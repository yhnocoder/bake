import { labelInSvg, texInSvg } from './tex.js'

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
    this.parts = []
    this.definitions = []
  }

  add(markup) {
    this.parts.push(markup)
  }

  el(name, attrs = {}, text) {
    this.parts.push(`<${name}${attributes(attrs)}>${text == null ? '' : escapeText(text)}</${name}>`)
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

  tex(tex, size, x, y, align, color) {
    const result = texInSvg(tex, size, x, y, align, color)
    this.parts.push(result.then((math) => math.markup))
    return result
  }

  texOnBackground(tex, size, x, y, align, color) {
    const result = texInSvg(tex, size, x, y, align, color)
    this.parts.push(
      result.then(
        (math) =>
          `<rect${attributes({ x: math.left - 2, y: math.top - 1, width: math.width + 4, height: math.height + 2, fill: 'var(--surface)' })}/>${math.markup}`,
      ),
    )
    return result
  }

  label(text, size, x, y, align = 'middle', color = '') {
    const result = labelInSvg(text, size, x, y, align, color)
    this.parts.push(result.then((label) => label.markup))
    return result
  }

  group(attrs, draw) {
    this.parts.push(`<g${attributes(attrs)}>`)
    draw()
    this.parts.push('</g>')
  }

  async markup() {
    const body = (await Promise.all(this.parts)).join('')
    return `<defs>${this.definitions.join('')}</defs>${body}`
  }
}
