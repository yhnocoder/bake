import { MathJaxNewcmFont } from '@mathjax/mathjax-newcm-font/js/svg.js'
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js'
import { TeX } from '@mathjax/src/js/input/tex.js'
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js'
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js'
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js'
import '@mathjax/src/js/input/tex/boldsymbol/BoldsymbolConfiguration.js'
import '@mathjax/src/js/input/tex/mathtools/MathtoolsConfiguration.js'
import '@mathjax/src/js/input/tex/cancel/CancelConfiguration.js'
import '@mathjax/src/js/input/tex/color/ColorConfiguration.js'
import { mathjax } from '@mathjax/src/js/mathjax.js'
import { SVG } from '@mathjax/src/js/output/svg.js'

mathjax.asyncLoad = (name) => import(name)

const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)

const glyphReference = /href=\\?"#(MJX-[^"\\]+)/g
const latexAttribute = / data-latex(?:-item)?="[^"]*"/g

export function createMathRenderer() {
  const input = new TeX({
    packages: ['base', 'ams', 'newcommand', 'boldsymbol', 'mathtools', 'cancel', 'color'],
    formatError: (_, error) => {
      throw error
    },
  })
  const output = new SVG({ fontData: MathJaxNewcmFont, fontCache: 'global', useXlink: false, linebreaks: { inline: false } })
  const document = mathjax.document('', { InputJax: input, OutputJax: output })
  const cache = new Map()
  let queue = Promise.resolve()

  async function convert(tex, display) {
    const container = await document.convertPromise(tex, { display })
    return adaptor.outerHTML(container).replace(latexAttribute, '')
  }

  function render(tex, display) {
    const key = `${display ? 'D' : 'I'}:${tex}`
    if (cache.has(key)) return cache.get(key)
    const result = queue.then(() => convert(tex, display))
    queue = result.catch(() => {})
    cache.set(key, result)
    result.catch(() => cache.delete(key))
    return result
  }

  function defineMacros(tex) {
    const result = queue.then(() => convert(tex, false))
    queue = result.catch(() => {})
    return result
  }

  function glyphDefinitions(html) {
    const ids = [...new Set([...html.matchAll(glyphReference)].map((match) => match[1]))]
    if (ids.length === 0) return ''
    const paths = ids.map((id) => `<path id="${id}" d="${output.fontCache.cache.get(id)}"></path>`).join('')
    return `<svg class="bk-math-defs" aria-hidden="true" style="display:none"><defs>${paths}</defs></svg>`
  }

  return { render, defineMacros, glyphDefinitions }
}
