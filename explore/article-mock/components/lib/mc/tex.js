import { mathjax } from '@mathjax/src/js/mathjax.js'
import { TeX } from '@mathjax/src/js/input/tex.js'
import { SVG } from '@mathjax/src/js/output/svg.js'
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js'
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js'
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js'
import { MathJaxNewcmFont } from '@mathjax/mathjax-newcm-font/js/svg.js'

const fontFiles = import.meta.glob('../../../node_modules/@mathjax/mathjax-newcm-font/mjs/svg/dynamic/*.js', { exhaustive: true })
const fontFileByName = new Map(Object.entries(fontFiles).map(([path, load]) => [path.split('/').pop(), load]))
mathjax.asyncLoad = (name) => fontFileByName.get(name.split('/').pop().replace(/(\.js)?$/, '.js'))()

const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)
const mathDocument = mathjax.document('', {
  InputJax: new TeX({ packages: ['base', 'ams'] }),
  OutputJax: new SVG({ fontData: MathJaxNewcmFont, fontCache: 'none', linebreaks: { inline: false } }),
})

const converted = new Map()

export function convert(tex, display = false) {
  const key = (display ? 'D' : 'I') + tex
  if (!converted.has(key)) {
    converted.set(
      key,
      mathjax
        .handleRetriesFor(() => mathDocument.convert(tex, { display, em: 16, ex: 8, containerWidth: 1280 }))
        .then((container) => {
          const svg = adaptor.firstChild(container)
          const attribute = (name) => adaptor.getAttribute(svg, name)
          const shift = Number((attribute('style') || '').match(/vertical-align:\s*(-?[\d.]+)ex/)?.[1] || 0)
          return {
            width: parseFloat(attribute('width')),
            height: parseFloat(attribute('height')),
            shift,
            viewBox: attribute('viewBox'),
            body: adaptor.innerHTML(svg),
            html: adaptor.outerHTML(svg),
          }
        }),
    )
  }
  return converted.get(key)
}

const escapeText = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function texInSvg(tex, size, x, y, align = 'middle', color = 'var(--ink)') {
  const math = await convert(tex, false)
  const ex = size * 0.45
  const width = math.width * ex
  const height = math.height * ex
  const left = align === 'middle' ? x - width / 2 : align === 'end' ? x - width : x
  const top = y - height - math.shift * ex
  return {
    width,
    height,
    left,
    top,
    markup: `<svg x="${left}" y="${top}" width="${width}" height="${height}" viewBox="${math.viewBox}" overflow="visible" fill="currentColor" style="color:${color || 'var(--ink)'}">${math.body}</svg>`,
  }
}

let measureContext
function textWidth(text, size) {
  measureContext ??= document.createElement('canvas').getContext('2d')
  const family = getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'sans-serif'
  measureContext.font = `${size}px ${family}`
  return measureContext.measureText(text).width
}

export async function labelInSvg(text, size, x, y, align = 'middle', color = 'var(--ink)') {
  const parts = await Promise.all(
    text.split('$').map(async (part, index) => {
      if (!part) return null
      if (index % 2) return { math: await texInSvg(part, size, 0, y, 'start', color) }
      return { text: part, width: textWidth(part, size) }
    }),
  )
  const pieces = parts.filter(Boolean).map((part) => (part.math ? { ...part, width: part.math.width } : part))
  const total = pieces.reduce((sum, piece) => sum + piece.width, 0)
  let left = align === 'middle' ? x - total / 2 : align === 'end' ? x - total : x
  const start = left
  const markup = pieces
    .map((piece) => {
      const at = left
      left += piece.width
      if (piece.math) return piece.math.markup.replace(/^<svg x="[^"]*"/, `<svg x="${at}"`)
      return `<text x="${at}" y="${y}" xml:space="preserve" style="font-size:${size}px;font-family:var(--font-ui);fill:${color || 'var(--ink)'}">${escapeText(piece.text)}</text>`
    })
    .join('')
  return { markup, left: start, width: total }
}

export async function mathHtml(text) {
  const blocks = text.split('$$')
  const html = await Promise.all(
    blocks.map(async (block, blockIndex) => {
      if (blockIndex % 2) return `<span class="mc-display">${(await convert(block.trim(), true)).html}</span>`
      const parts = await Promise.all(
        block.split('$').map(async (part, index) => (index % 2 ? (await convert(part, false)).html : part)),
      )
      return parts.join('')
    }),
  )
  return html.join('')
}
