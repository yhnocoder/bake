import { createSignal } from 'solid-js'

const typeset = new Map()

function request(tex) {
  if (!typeset.has(tex)) {
    const [state, setState] = createSignal(null)
    typeset.set(tex, state)
    import('bake/math')
      .then(({ texToSvg }) => texToSvg(tex))
      .then((svg) => {
        svg.setAttribute('role', 'img')
        svg.setAttribute('aria-label', tex)
        setState(svg)
      })
      .catch((error) => {
        console.error(`the TeX label "${tex}" cannot be typeset: ${error.message}`)
        setState(false)
      })
  }
  return typeset.get(tex)()
}

export function texSvg(tex) {
  const svg = request(tex)
  return svg ? svg.cloneNode(true) : null
}

export function texFailed(tex) {
  return request(tex) === false
}

export function texBox(tex, emSize) {
  const svg = texSvg(tex)
  if (!svg) return null
  const [, minY, width, height] = svg.getAttribute('viewBox').split(/\s+/).map(Number)
  const scale = emSize / 1000
  return { svg, width: width * scale, height: height * scale, ascent: -minY * scale }
}

export const segments = (source) =>
  source
    .split('$')
    .map((text, index) => ({ math: index % 2 === 1, text }))
    .filter((part) => part.text)

export function richNodes(source) {
  return segments(source).map((part) => {
    if (!part.math) return document.createTextNode(part.text)
    const svg = texSvg(part.text)
    if (!svg) return document.createTextNode(texFailed(part.text) ? part.text : '')
    svg.classList.add('llm-tex')
    return svg
  })
}

const PLAIN = {
  to: '→', approx: '≈', infty: '∞', sigma: 'σ', Phi: 'Φ', beta: 'β', phi: 'φ', tanh: 'tanh', ln: 'ln',
  odot: '⊙', cdot: '·', times: '×', mathrm: '', tfrac: '', frac: '', text: '',
}

export const plainText = (source) =>
  source
    .replace(/\$/g, '')
    .replace(/\\([A-Za-z]+|[,;! ])/g, (match, name) => PLAIN[name] ?? ' ')
    .replace(/[{}]/g, '')
