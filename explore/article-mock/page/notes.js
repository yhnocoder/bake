import { onFrame } from './blocks.js'

const narrow = matchMedia('(max-width: 999.98px)')
const noteGap = 12

function refsFor(article, number) {
  return [...article.querySelectorAll(`.bk-ref[data-note="${number}"]`)]
}

function caretTop(ref) {
  const range = document.createRange()
  range.setStartBefore(ref)
  range.collapse(true)
  const rect = range.getBoundingClientRect()
  if (rect.height > 0) return { top: rect.top, height: rect.height }
  const box = ref.getBoundingClientRect()
  return { top: box.top, height: box.height }
}

function obstacles(article, articleTop) {
  const right = article.getBoundingClientRect().right
  const selector =
    '.bk-block[data-width="wide"], .bk-block[data-resolved="wide"], .bk-block[data-width="page"], .bk-fig[data-width="wide"], .bk-fig[data-width="page"]'
  return [...article.querySelectorAll(selector)]
    .filter((element) => !element.closest('.bk-notes-layer') && element.offsetParent !== null && element.getBoundingClientRect().right > right + 1)
    .map((element) => {
      const rect = element.getBoundingClientRect()
      return { top: rect.top - articleTop, bottom: rect.bottom - articleTop }
    })
}

function place(article, layer, placed) {
  if (narrow.matches) return
  const articleTop = article.getBoundingClientRect().top
  const blocked = obstacles(article, articleTop)
  let floor = -Infinity
  for (const { note, number } of placed) {
    const ref = refsFor(article, number).find((element) => element.offsetParent !== null)
    if (!ref) {
      note.hidden = true
      continue
    }
    note.hidden = false
    const caret = caretTop(ref)
    const lineHeight = parseFloat(getComputedStyle(note).lineHeight) || 23
    let top = caret.top - articleTop + (caret.height - lineHeight) / 2
    top = Math.max(top, floor)
    const height = note.offsetHeight
    for (let moved = true; moved; ) {
      moved = false
      for (const block of blocked) {
        if (top < block.bottom && top + height > block.top) {
          top = block.bottom + noteGap
          moved = true
        }
      }
    }
    note.style.top = `${Math.round(top)}px`
    floor = top + height + noteGap
  }
}

function setHot(article, number, on) {
  for (const element of article.querySelectorAll(`.bk-ref[data-note="${number}"], .bk-sn[data-note="${number}"]`)) element.classList.toggle('is-hot', on)
}

function tintParagraph(article, number, on) {
  const ref = refsFor(article, number)[0]
  const block = ref?.closest('p, li, td, th, .bk-block, figcaption, blockquote, .bk-callout')
  block?.classList.toggle('bk-tinted', on)
}

export function startNotes(article) {
  const originals = [...article.querySelectorAll('.bk-sn')].filter((note) => !note.closest('.bk-embed'))
  if (originals.length === 0) return
  const layer = document.createElement('div')
  layer.className = 'bk-notes-layer'
  layer.setAttribute('aria-hidden', 'true')
  const placed = originals.map((original) => {
    const note = original.cloneNode(true)
    note.removeAttribute('id')
    note.classList.add('bk-sn-placed')
    layer.append(note)
    return { note, number: original.dataset.note }
  })
  article.append(layer)
  const layout = onFrame(() => place(article, layer, placed))
  layout()
  new ResizeObserver(layout).observe(article)
  document.addEventListener('bk:layout', layout)
  document.fonts?.ready.then(layout)
  narrow.addEventListener('change', layout)

  article.addEventListener('pointerover', (event) => {
    const ref = event.target.closest('.bk-ref')
    if (ref) setHot(article, ref.dataset.note, true)
    const note = event.target.closest('.bk-notes-layer .bk-sn')
    if (note) {
      setHot(article, note.dataset.note, true)
      tintParagraph(article, note.dataset.note, true)
    }
  })
  article.addEventListener('pointerout', (event) => {
    const ref = event.target.closest('.bk-ref')
    if (ref && !ref.contains(event.relatedTarget)) setHot(article, ref.dataset.note, false)
    const note = event.target.closest('.bk-notes-layer .bk-sn')
    if (note && !note.contains(event.relatedTarget)) {
      setHot(article, note.dataset.note, false)
      tintParagraph(article, note.dataset.note, false)
    }
  })
  article.addEventListener('click', (event) => {
    const link = event.target.closest('.bk-ref a')
    if (!link) return
    event.preventDefault()
    const number = link.parentElement.dataset.note
    if (narrow.matches) {
      const inline = article.querySelector(`#sn-${number}`)
      const open = !inline.classList.contains('is-open')
      inline.classList.toggle('is-open', open)
      link.setAttribute('aria-expanded', String(open))
      return
    }
    const note = layer.querySelector(`.bk-sn[data-note="${number}"]`)
    note.classList.add('bk-flash')
    setTimeout(() => note.classList.remove('bk-flash'), 700)
  })
}
