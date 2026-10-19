import { toast } from './blocks.js'

const skipped = '[data-ui], .bk-notes-layer, .bk-sn, .bk-slot, .bk-math-defs, .bk-fold-icon, .bk-eq-anchor, button, input, select, textarea'

function clampToArticle(range, article) {
  if (!range.intersectsNode(article)) return null
  const whole = document.createRange()
  whole.selectNodeContents(article)
  const clamped = range.cloneRange()
  if (clamped.compareBoundaryPoints(Range.START_TO_START, whole) < 0) clamped.setStart(whole.startContainer, whole.startOffset)
  if (clamped.compareBoundaryPoints(Range.END_TO_END, whole) > 0) clamped.setEnd(whole.endContainer, whole.endOffset)
  return clamped.collapsed ? null : clamped
}

function containsWhole(range, element) {
  const inside = document.createRange()
  inside.selectNode(element)
  return range.compareBoundaryPoints(Range.START_TO_START, inside) <= 0 && range.compareBoundaryPoints(Range.END_TO_END, inside) >= 0
}

function selectedFragment(range, article) {
  const whole = []
  for (const element of article.querySelectorAll('[data-md]')) {
    const isComponent = element.matches('.bk-component')
    if ((isComponent && range.intersectsNode(element)) || containsWhole(range, element)) {
      element.setAttribute('data-md-whole', '')
      whole.push(element)
    }
  }
  const fragment = range.cloneContents()
  for (const element of whole) element.removeAttribute('data-md-whole')
  const ancestor = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement
  const component = ancestor.closest('.bk-component[data-md]')
  if (component) {
    const single = component.cloneNode(false)
    single.setAttribute('data-md-whole', '')
    return wrap(single)
  }
  for (const selector of ['pre', '.bk-math[data-tex]', '.bk-m[data-tex]', 'h2, h3, h4', 'li', 'blockquote', 'mark', 'strong', 'em', 'a']) {
    const outer = ancestor.closest(selector)
    if (outer && article.contains(outer)) {
      const shell = outer.cloneNode(false)
      shell.append(fragment)
      return wrap(shell)
    }
  }
  return fragment
}

function wrap(node) {
  const fragment = document.createDocumentFragment()
  fragment.append(node)
  return fragment
}

function collapseSpace(text) {
  return text.replace(/\s+/g, ' ')
}

function createWriter(article) {
  const notes = []

  function inline(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.parentElement?.closest('pre') ? node.textContent : collapseSpace(node.textContent)
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    if (node.matches('.bk-ref')) return noteReference(node)
    if (node.matches(skipped)) return ''
    if (node.matches('.bk-m[data-tex]')) return `$${node.dataset.tex}$`
    if (node.matches('br')) return '\n'
    if (node.matches('img')) return `![${node.alt}](${node.getAttribute('src')})`
    const text = children(node, inline)
    if (!text.trim()) return text
    if (node.matches('mark')) return `==${text}==`
    if (node.matches('strong, b')) return `**${text}**`
    if (node.matches('em, i')) return `*${text}*`
    if (node.matches('del')) return `~~${text}~~`
    if (node.matches('code')) return `\`${node.textContent}\``
    if (node.matches('.bk-cite')) return `[${[...node.querySelectorAll('a[data-ref]')].map((link) => `@${link.dataset.ref}`).join('; ')}]`
    if (node.matches('a[href]') && !node.matches('.bk-eqref')) return `[${text}](${node.getAttribute('href')})`
    return text
  }

  function noteReference(node) {
    const number = node.dataset.note
    let index = notes.indexOf(number)
    if (index === -1) {
      notes.push(number)
      index = notes.length - 1
    }
    return `[^${index + 1}]`
  }

  function children(node, write) {
    return [...node.childNodes].map(write).join('')
  }

  function block(node) {
    if (node.nodeType === Node.TEXT_NODE) return collapseSpace(node.textContent)
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    if (node.matches('[data-md-whole]')) return `\n\n${node.dataset.md}\n\n`
    if (node.matches('.bk-ref')) return noteReference(node)
    if (node.matches(skipped)) return ''
    if (node.matches('p')) return `\n\n${children(node, inline).trim()}\n\n`
    if (node.matches('h2, h3, h4')) return `\n\n${'#'.repeat(Number(node.tagName[1]))} ${children(node, inline).trim()}\n\n`
    if (node.matches('.bk-math[data-tex]')) return `\n\n$$\n${node.dataset.tex.trim()}\n$$\n\n`
    if (node.matches('pre')) return `\n\n\`\`\`${node.dataset.lang ?? ''}\n${node.textContent.replace(/\n$/, '')}\n\`\`\`\n\n`
    if (node.matches('ul, ol')) return `\n\n${listItems(node)}\n\n`
    if (node.matches('li')) return `\n- ${children(node, block).trim()}\n`
    if (node.matches('blockquote')) return `\n\n${quoted(children(node, block).trim())}\n\n`
    if (node.matches('hr')) return '\n\n---\n\n'
    if (node.matches('.bk-m, mark, strong, em, a, code, del, sup, span, summary, figcaption')) return inline(node)
    return children(node, block)
  }

  function listItems(list) {
    const ordered = list.matches('ol')
    return [...list.children]
      .filter((item) => item.matches('li'))
      .map((item, index) => {
        const marker = ordered ? `${index + 1}. ` : '- '
        const body = tidy(children(item, block))
        return marker + body.replaceAll('\n', `\n${' '.repeat(marker.length)}`)
      })
      .join('\n')
  }

  function quoted(text) {
    return text
      .split('\n')
      .map((line) => (line ? `> ${line}` : '>'))
      .join('\n')
  }

  function footnotes() {
    return notes
      .map((number, index) => {
        const note = article.querySelector(`.bk-sn#sn-${number} .bk-sn-body`)
        return note ? `[^${index + 1}]: ${tidy(children(note, block)).replaceAll('\n\n', '\n\n    ')}` : ''
      })
      .filter(Boolean)
      .join('\n\n')
  }

  return {
    write(fragment) {
      let markdown = tidy(children(fragment, block))
      const tail = footnotes()
      if (tail) markdown += `\n\n${tail}`
      return markdown
    },
  }
}

function tidy(text) {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function selectionMarkdown(selection, article) {
  if (!selection.rangeCount || selection.isCollapsed) return null
  const range = clampToArticle(selection.getRangeAt(0), article)
  if (!range) return null
  const markdown = createWriter(article).write(selectedFragment(range, article))
  const html = document.createElement('div')
  html.append(range.cloneContents())
  for (const element of html.querySelectorAll(skipped)) element.remove()
  return { markdown, html: html.innerHTML }
}

export function startCopy(article) {
  document.addEventListener('copy', (event) => {
    const result = selectionMarkdown(getSelection(), article)
    if (!result?.markdown) return
    event.preventDefault()
    event.clipboardData.setData('text/plain', result.markdown)
    event.clipboardData.setData('text/html', result.html)
    toast('已复制为 Markdown')
  })
}
