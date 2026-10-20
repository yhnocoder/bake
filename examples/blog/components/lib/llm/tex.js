const pending = new Map()
const typeset = new Map()

export const segments = (source) =>
  source
    .split('$')
    .map((text, index) => ({ math: index % 2 === 1, text }))
    .filter((part) => part.text)

const formulasOf = (sources) => [...new Set(sources.flatMap((source) => segments(source).filter((part) => part.math).map((part) => part.text)))]

function typesetOne(component, texToSvg, tex) {
  if (!pending.has(tex)) {
    pending.set(
      tex,
      texToSvg(tex).then(
        (svg) => typeset.set(tex, svg),
        (error) => console.error(`${component}: the TeX label "${tex}" cannot be typeset: ${error.message}`),
      ),
    )
  }
  return pending.get(tex)
}

export async function typesetAll(component, sources) {
  const { texToSvg } = await import('bake/math')
  await Promise.all(formulasOf(sources).map((tex) => typesetOne(component, texToSvg, tex)))
  return true
}

const pause = () => new Promise((resolve) => setTimeout(resolve))

export async function typesetLater(component, sources) {
  const { texToSvg } = await import('bake/math')
  for (const tex of formulasOf(sources)) {
    if (pending.has(tex)) continue
    await pause()
    await typesetOne(component, texToSvg, tex)
  }
}

export function texSvg(tex) {
  const svg = typeset.get(tex)
  return svg === undefined ? null : svg.cloneNode(true)
}

export function texBox(tex, emSize) {
  const svg = texSvg(tex)
  if (svg === null) return null
  const [, minY, width, height] = svg.getAttribute('viewBox').split(/\s+/).map(Number)
  const scale = emSize / 1000
  return { svg, width: width * scale, height: height * scale, ascent: -minY * scale }
}

export function richNodes(source) {
  return segments(source).map((part) => {
    const svg = part.math ? texSvg(part.text) : null
    if (svg === null) return document.createTextNode(part.text)
    svg.classList.add('llm-tex')
    svg.setAttribute('aria-hidden', 'true')
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
