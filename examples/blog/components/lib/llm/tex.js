import { mathjax } from '@mathjax/src/js/mathjax.js'
import { TeX } from '@mathjax/src/js/input/tex.js'
import { SVG } from '@mathjax/src/js/output/svg.js'
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js'
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js'
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js'
import { MathJaxNewcmFont } from '@mathjax/mathjax-newcm-font/js/svg.js'

const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)

const texDocument = mathjax.document('', {
  InputJax: new TeX({ packages: ['base', 'ams'] }),
  OutputJax: new SVG({ fontData: MathJaxNewcmFont, fontCache: 'none', linebreaks: { inline: false } }),
})

const rendered = new Map()

function renderTex(tex) {
  const template = document.createElement('template')
  template.innerHTML = adaptor.innerHTML(texDocument.convert(tex, { display: false }))
  return template.content.querySelector('svg')
}

export function texSvg(tex) {
  if (!rendered.has(tex)) rendered.set(tex, renderTex(tex))
  return rendered.get(tex).cloneNode(true)
}

export function texBox(tex, emSize) {
  const svg = texSvg(tex)
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
