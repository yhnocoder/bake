import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { imageSize } from 'image-size'
import { widthDirective } from './parse.js'
import { parseAttributes } from './inline.js'

const internalPattern = /^\/(\d{4}-\d{2})\/([a-z0-9-]+)\/(?:#(.+))?$/
const widths = new Set(['body', 'wide', 'page'])
const sizePattern = /^(\d+(?:\.\d+)?)(px|%)$/
const sizeCache = new Map()

export function escapeHtml(text) {
  return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function escapeAttribute(text) {
  return escapeHtml(text).replaceAll('"', '&quot;')
}

function isPage(ctx) {
  return ctx.mode === 'page'
}

export function relativeTo(host, path) {
  return `../../${path}/`
}

export function hrefFor(ctx, article, anchor) {
  const base = article === ctx.host ? '' : relativeTo(ctx.host, article.path)
  if (anchor) return `${base}#${encodeURIComponent(anchor)}`
  return base || './'
}

function assetUrl(ctx, src) {
  if (/^[a-z]+:|^\/|^#/i.test(src)) return src
  return ctx.article === ctx.host ? src : `${relativeTo(ctx.host, ctx.article.path)}${src}`
}

function intrinsicSize(ctx, src) {
  if (src.startsWith('/') || /^[a-z]+:/i.test(src)) return null
  const file = join(ctx.article.dir, decodeURIComponent(src))
  if (!sizeCache.has(file)) {
    try {
      sizeCache.set(file, imageSize(readFileSync(file)))
    } catch {
      sizeCache.set(file, null)
    }
  }
  return sizeCache.get(file)
}

export function resolveInternal(ctx, url, node) {
  const match = internalPattern.exec(url)
  if (!match) {
    ctx.fail(node, `internal link ${url} must have the form /YYYY-MM/slug/ or /YYYY-MM/slug/#anchor`)
    return null
  }
  const target = ctx.site.get(`/${match[1]}/${match[2]}/`)
  if (!target) {
    ctx.fail(node, `link target ${url} does not exist`)
    return null
  }
  const anchor = match[3] ? decodeURIComponent(match[3]) : null
  const entry = anchor ? target.anchors.get(anchor) : null
  if (anchor && !entry) {
    ctx.fail(node, `link target ${url} does not exist`)
    return null
  }
  return { article: target, anchor, entry }
}

function isInternal(url) {
  return url.startsWith('/') && !url.startsWith('//')
}

function renderPhrasing(nodes, ctx) {
  return nodes.map((node) => renderInline(node, ctx)).join('')
}

function citeHtml(node, ctx) {
  const parts = node.keys.map((key) => {
    const reference = ctx.article.references.get(key)
    if (!reference) return escapeHtml(`@${key}`)
    if (!isPage(ctx)) return String(reference.number)
    return `<a href="#ref-${escapeAttribute(key)}" data-ref="${escapeAttribute(key)}">${reference.number}</a>`
  })
  return `<span class="bk-cite">[${parts.join(', ')}]</span>`
}

function eqrefHtml(node, ctx) {
  if (!node.label) return escapeHtml(`\\eqref{${node.name}}`)
  const text = `式 (${node.label.number})`
  if (ctx.mode === 'preview') return `<span class="bk-eqref">${text}</span>`
  if (ctx.article !== ctx.host) return `<a class="bk-eqref" href="${escapeAttribute(hrefFor(ctx, ctx.article, node.label.id))}">${text}</a>`
  return `<a class="bk-eqref" href="#${node.label.id}" data-eq="${node.label.id}">${text}</a>`
}

function footnoteHtml(node, ctx) {
  if (!isPage(ctx) || !node.note) return ''
  const { number } = node.note
  if (!ctx.state.shownNotes.has(number)) {
    ctx.state.shownNotes.add(number)
    ctx.sink.push(node.note)
  }
  return `<sup class="bk-ref" data-note="${number}"><a href="#sn-${number}" role="button" aria-label="旁注 ${number}">${number}</a></sup>`
}

function linkHtml(node, ctx) {
  const inner = renderPhrasing(node.children, ctx)
  const title = node.title ? ` title="${escapeAttribute(node.title)}"` : ''
  if (!isInternal(node.url)) return `<a class="bk-link" href="${escapeAttribute(node.url)}"${title}>${inner}</a>`
  const target = resolveInternal(ctx, node.url, node)
  if (!target) return `<a class="bk-link">${inner}</a>`
  const href = escapeAttribute(hrefFor(ctx, target.article, target.anchor))
  if (ctx.mode === 'preview') return `<a class="bk-link bk-internal" href="${href}"${title}>${inner}</a>`
  const key = `${target.article.url}#${target.anchor ?? ''}`
  ctx.state.previews.set(key, target)
  return `<a class="bk-link bk-internal" href="${href}" data-preview="${escapeAttribute(key)}"${title}>${inner}</a>`
}

function imageSizeStyle(attributes, ctx, node) {
  const style = []
  for (const name of ['width', 'height']) {
    const value = attributes?.[name]
    if (value === undefined) continue
    const match = sizePattern.exec(value)
    if (!match) {
      ctx.fail(node.attributesPosition ?? node, `image ${name} must be pixels or a percentage, such as 160px or 50%; got ${value}`)
      continue
    }
    style.push(`${name}:${value}`)
  }
  return style
}

function imgTag(node, ctx, style = []) {
  const size = intrinsicSize(ctx, node.url)
  const dimensions = size ? ` width="${size.width}" height="${size.height}"` : ''
  const styleAttribute = style.length ? ` style="${style.join(';')}"` : ''
  return `<img src="${escapeAttribute(assetUrl(ctx, node.url))}" alt="${escapeAttribute(node.alt ?? '')}"${dimensions}${styleAttribute} loading="lazy" decoding="async">`
}

function renderInline(node, ctx) {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.value)
    case 'emphasis':
      return `<em>${renderPhrasing(node.children, ctx)}</em>`
    case 'strong':
      return `<strong>${renderPhrasing(node.children, ctx)}</strong>`
    case 'delete':
      return `<del>${renderPhrasing(node.children, ctx)}</del>`
    case 'mark':
      return `<mark>${renderPhrasing(node.children, ctx)}</mark>`
    case 'inlineCode':
      return `<code>${escapeHtml(node.value)}</code>`
    case 'inlineMath':
      return `<span class="bk-m">${node.svg ?? ''}</span>`
    case 'break':
      return '<br>'
    case 'html':
      return node.value
    case 'link':
      return linkHtml(node, ctx)
    case 'linkReference':
    case 'imageReference':
      return escapeHtml(`[${node.label}]`)
    case 'image': {
      for (const name of Object.keys(node.attributes ?? {}))
        if (!['width', 'height'].includes(name)) ctx.fail(node, `inline image attribute ${name} is not supported; float needs the image alone in its paragraph`)
      return imgTag({ ...node }, ctx, imageSizeStyle(node.attributes, ctx, node)).replace('<img ', '<img class="bk-inline-img" ')
    }
    case 'cite':
      return citeHtml(node, ctx)
    case 'eqref':
      return eqrefHtml(node, ctx)
    case 'footnoteReference':
      return footnoteHtml(node, ctx)
    default:
      ctx.fail(node, `unsupported inline content ${node.type}`)
      return ''
  }
}

function soleImage(node) {
  const children = node.children.filter((child) => !(child.type === 'text' && child.value.trim() === ''))
  return children.length === 1 && children[0].type === 'image' ? children[0] : null
}

function imageFigure(image, ctx) {
  const attributes = image.attributes ?? {}
  for (const name of Object.keys(attributes)) {
    if (!['width', 'height', 'float'].includes(name)) ctx.fail(image.attributesPosition ?? image, `unknown image attribute ${name}`)
  }
  const float = attributes.float
  if (float && !['left', 'right'].includes(float)) ctx.fail(image.attributesPosition ?? image, `float must be left or right, got ${float}`)
  const style = imageSizeStyle(attributes, ctx, image)
  const caption = image.title ? `<figcaption>${escapeHtml(image.title)}</figcaption>` : ''
  if (float) {
    const figureStyle = attributes.width ? ` style="width:${attributes.width}"` : ''
    return `<figure class="bk-fig bk-image bk-float" data-float="${float}"${figureStyle}>${imgTag(image, ctx, attributes.height ? [`height:${attributes.height}`] : [])}${caption}</figure>`
  }
  const width = ctx.width ?? 'body'
  return `<figure class="bk-fig bk-image" data-width="${width}">${imgTag(image, ctx, style)}${caption}</figure>`
}

function paragraphHtml(node, ctx) {
  const image = soleImage(node)
  if (image) return imageFigure(image, ctx)
  const id = node.id && isPage(ctx) ? ` id="${escapeAttribute(node.id)}"` : ''
  return `<p${id}>${renderPhrasing(node.children, ctx)}</p>`
}

function headingHtml(node, ctx) {
  const text = renderPhrasing(node.children, ctx)
  if (!isPage(ctx) || ctx.nested) return `<div class="bk-embed-h bk-embed-h${node.depth}">${text}</div>`
  const id = escapeAttribute(node.id)
  const hash = `<a class="bk-hash" href="#${id}" aria-label="复制本节链接">#</a>`
  if (node.depth === 2) {
    const number = node.chapter ? `<span class="bk-chapter-num">${node.chapter.number}</span>` : ''
    return `<h2 id="${id}">${number}${hash}<span class="bk-h-text">${text}</span></h2>`
  }
  const level = Math.min(node.depth, 4)
  return `<h${level} id="${id}">${hash}<span class="bk-h-text">${text}</span></h${level}>`
}

function cellContent(children, ctx) {
  if (children.length === 1 && children[0].type === 'paragraph') return renderPhrasing(children[0].children, ctx)
  return renderFlow(children, ctx)
}

function listHtml(node, ctx) {
  const tag = node.ordered ? 'ol' : 'ul'
  const start = node.ordered && node.start && node.start !== 1 ? ` start="${node.start}"` : ''
  const items = node.children
    .map((item) => {
      const check = item.checked === true ? '<input type="checkbox" checked disabled> ' : item.checked === false ? '<input type="checkbox" disabled> ' : ''
      const content = node.spread || item.spread ? renderFlow(item.children, ctx) : renderTight(item.children, ctx)
      return `<li>${check}${content}</li>`
    })
    .join('')
  return `<${tag}${start}>${items}</${tag}>`
}

function renderTight(children, ctx) {
  return flowWithNotes(children, ctx, (child, inner) =>
    child.type === 'paragraph' && !soleImage(child) ? renderPhrasing(child.children, inner) : renderBlock(child, inner),
  )
}

function blockquoteHtml(node, ctx) {
  const children = [...node.children]
  const last = children.at(-1)
  let source = ''
  const first = last?.type === 'paragraph' ? last.children[0] : null
  if (first?.type === 'text' && /^——?\s/.test(first.value) && children.length > 1) {
    children.pop()
    const rest = [{ ...first, value: first.value.replace(/^——?\s+/, '') }, ...last.children.slice(1)]
    source = `<footer class="bk-quote-src">${renderPhrasing(rest, ctx)}</footer>`
  }
  return `<blockquote class="bk-quote">${renderFlow(children, ctx)}${source}</blockquote>`
}

function block(kind, ctx, inner, extra = '') {
  return `<div class="bk-block bk-${kind}" data-width="${ctx.width ?? 'auto'}"${extra}><div class="bk-scroll">${inner}</div></div>`
}

function tableHtml(node, ctx) {
  const align = node.align ?? []
  const rows = node.children.map((row, rowIndex) => {
    const tag = rowIndex === 0 ? 'th' : 'td'
    const cells = row.children.map((cell, index) => {
      const style = align[index] ? ` style="text-align:${align[index]}"` : ''
      return `<${tag}${style}>${renderPhrasing(cell.children, ctx)}</${tag}>`
    })
    return `<tr>${cells.join('')}</tr>`
  })
  return block('table', ctx, `<table><thead>${rows[0]}</thead><tbody>${rows.slice(1).join('')}</tbody></table>`)
}

function listTableHtml(node, ctx) {
  const list = node.children[0]
  if (node.children.length !== 1 || list?.type !== 'list') {
    ctx.fail(node, ':::list-table must contain one list; each item is a row and its sub-items are the cells')
    return ''
  }
  let columns = null
  const rows = list.children.map((item, rowIndex) => {
    const cellsList = item.children.find((child) => child.type === 'list')
    if (!cellsList || item.children.length !== 1) {
      ctx.fail(item, 'each list-table row must be a list item that contains only a list of cells')
      return ''
    }
    if (columns === null) columns = cellsList.children.length
    else if (cellsList.children.length !== columns)
      ctx.fail(item, `list-table row ${rowIndex + 1} has ${cellsList.children.length} cells; the first row has ${columns}`)
    const tag = rowIndex === 0 ? 'th' : 'td'
    return `<tr>${cellsList.children.map((cell) => `<${tag}>${cellContent(cell.children, ctx)}</${tag}>`).join('')}</tr>`
  })
  return block('table', ctx, `<table class="bk-list-table"><thead>${rows[0] ?? ''}</thead><tbody>${rows.slice(1).join('')}</tbody></table>`)
}

function codeHtml(node, ctx) {
  const lang = node.lang ? ` data-lang="${escapeAttribute(node.lang)}"` : ''
  return block('code', ctx, `<pre${lang}><code>${node.html ?? escapeHtml(node.value)}</code></pre>`)
}

function mathHtml(node, ctx) {
  const labels = node.labels ?? []
  const id = isPage(ctx) && labels[0] ? ` id="${labels[0].id}"` : ''
  const extra = isPage(ctx)
    ? labels
        .slice(1)
        .map((label) => `<span class="bk-eq-anchor" id="${label.id}"></span>`)
        .join('')
    : ''
  return block('math', ctx, `${extra}${node.svg ?? ''}`, id)
}

function captionHtml(children, ctx) {
  if (children.length === 0) return ''
  return `<figcaption>${cellContent(children, ctx)}</figcaption>`
}

function componentHtml(node, ctx) {
  const component = node.component
  if (!component) return ''
  const caption = captionHtml(node.children, ctx)
  if (ctx.mode === 'preview') {
    const text = node.children.length ? cellContent(node.children, ctx) : `交互组件 ${escapeHtml(node.name)}`
    return `<div class="bk-pv-component">${text}</div>`
  }
  const width = ctx.width ?? component.width
  const frame = component.frame ? '' : ' data-frame="none"'
  const params = escapeAttribute(JSON.stringify(component.params))
  return `<figure class="bk-fig bk-component" data-width="${width}"${frame}><div class="bk-slot" data-component="${node.name}" data-params="${params}" style="${component.style}"></div>${caption}</figure>`
}

function titleOf(node) {
  return node.attributes?.title ?? ''
}

function checkAttributes(node, ctx, allowed) {
  for (const name of Object.keys(node.attributes ?? {})) {
    if (!allowed.includes(name)) ctx.fail(node, `:::${node.name === widthDirective ? '' : node.name} does not take the attribute ${name}`)
  }
}

function referencesHtml(node, ctx) {
  if (!isPage(ctx)) return ''
  const items = [...ctx.article.references.values()]
    .sort((a, b) => a.number - b.number)
    .map((reference) => {
      const body = renderTight(reference.item.children, ctx)
      return `<li id="ref-${escapeAttribute(reference.key)}" data-ref="${escapeAttribute(reference.key)}"><span class="bk-refs-num">[${reference.number}]</span><div class="bk-refs-text">${body}</div></li>`
    })
  return `<section class="bk-refs" id="references"><div class="bk-refs-title">参考文献</div><ol>${items.join('')}</ol></section>`
}

function embedRange(target) {
  const { entry, article } = target
  if (!entry) return { nodes: [], start: 0, end: 0 }
  if (entry.kind === 'heading') {
    const children = article.tree.children
    let end = entry.index + 1
    while (end < children.length && !(children[end].type === 'heading' && children[end].depth <= entry.node.depth)) end++
    return { nodes: children.slice(entry.index, end), start: entry.index, end }
  }
  if (entry.kind === 'paragraph' && entry.topLevel) return { nodes: [entry.node], start: entry.index, end: entry.index + 1 }
  return { nodes: [entry.node], start: entry.index, end: entry.index + 1, nested: true }
}

export function locationLabel(entry) {
  if (!entry) return ''
  const chapter = entry.chapter
  if (!chapter) return ''
  const section = entry.kind === 'heading' && entry.node.depth === 2 ? null : entry.section
  return section ? `${Number(chapter.number)}.${section.number}` : chapter.number
}

function embedAddresses(node) {
  const lines = []
  for (const paragraph of node.children) {
    if (paragraph.type !== 'paragraph') {
      lines.push({ error: 'each line of :::embed must be an internal address', node: paragraph })
      continue
    }
    let line = paragraph.position.start.line
    for (const child of paragraph.children) {
      if (child.type === 'link') {
        lines.push({ url: child.url, node: child })
        continue
      }
      if (child.type !== 'text') {
        lines.push({ error: 'each line of :::embed must be an internal address', node: child })
        continue
      }
      for (const text of child.value.split('\n')) {
        if (text.trim()) lines.push({ url: text.trim(), node: { position: { start: { line, column: 1 } } } })
        line++
      }
      line--
    }
  }
  return lines
}

function embedHtml(node, ctx) {
  const addresses = embedAddresses(node)
  if (!isPage(ctx) || ctx.nested) {
    const links = addresses
      .filter((address) => address.url)
      .map((address) => {
        const target = resolveInternal({ ...ctx, fail: () => {} }, address.url, address.node)
        if (!target) return ''
        return `<a class="bk-link" href="${escapeAttribute(hrefFor(ctx, target.article, target.anchor))}">${escapeHtml(target.article.title)} ${escapeHtml(locationLabel(target.entry))}</a>`
      })
    return `<p class="bk-embed-links">${links.filter(Boolean).join('<br>')}</p>`
  }
  const parts = []
  const seen = ctx.state.embedRanges
  for (const address of addresses) {
    if (address.error) {
      ctx.fail(address.node, address.error)
      continue
    }
    if (!isInternal(address.url)) {
      ctx.fail(address.node, `embed address ${address.url} must be an internal address /YYYY-MM/slug/#anchor`)
      continue
    }
    const target = resolveInternal(ctx, address.url, address.node)
    if (!target) continue
    if (target.article === ctx.host) {
      ctx.fail(address.node, `an article cannot embed itself: ${address.url}`)
      continue
    }
    if (!target.anchor) {
      ctx.fail(address.node, `embed address ${address.url} needs an anchor`)
      continue
    }
    const range = embedRange(target)
    const duplicate = seen.find((other) => other.url === address.url)
    if (duplicate) {
      ctx.fail(address.node, `${address.url} is embedded twice`)
      continue
    }
    const overlap = seen.find((other) => other.article === target.article && other.start < range.end && range.start < other.end)
    if (overlap) {
      ctx.fail(address.node, `${address.url} overlaps the embedded range of ${overlap.url}`)
      continue
    }
    seen.push({ url: address.url, article: target.article, start: range.start, end: range.end })
    const inner = { ...ctx, article: target.article, mode: 'embed', fail: (n, message) => ctx.failIn(target.article.file, n, message), width: undefined }
    const label = locationLabel(target.entry)
    const source = `<div class="bk-embed-src"><a href="${escapeAttribute(hrefFor(ctx, target.article, target.anchor))}">出自《${escapeHtml(target.article.title)}》${escapeHtml(label)} ↗</a></div>`
    parts.push(`<div class="bk-embed-part">${renderFlow(range.nodes, inner)}${source}</div>`)
  }
  return `<div class="bk-embed">${parts.join('')}</div>`
}

function directiveHtml(node, ctx) {
  switch (node.name) {
    case 'aside': {
      checkAttributes(node, ctx, ['title'])
      const title = titleOf(node) ? `<div class="bk-callout-title">${node.titleHtml ?? escapeHtml(titleOf(node))}</div>` : ''
      return `<div class="bk-callout">${title}${renderFlow(node.children, ctx)}</div>`
    }
    case 'fold': {
      checkAttributes(node, ctx, ['title'])
      const title = node.titleHtml ?? escapeHtml(titleOf(node) || '展开')
      const open = ctx.mode === 'preview' ? ' open' : ''
      return `<details class="bk-fold"${open}><summary><span class="bk-fold-title">${title}</span><svg class="bk-fold-icon" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></summary><div class="bk-fold-body">${renderFlow(node.children, ctx)}</div></details>`
    }
    case 'references':
      return referencesHtml(node, ctx)
    case 'list-table':
      checkAttributes(node, ctx, [])
      return listTableHtml(node, ctx)
    case 'embed':
      return embedHtml(node, ctx)
    case 'recap':
      return ''
    case widthDirective: {
      const width = node.attributes?.width
      checkAttributes(node, ctx, ['width'])
      if (!widths.has(width)) {
        ctx.fail(node, `width must be body, wide or page, got ${width}`)
        return renderFlow(node.children, ctx)
      }
      return renderFlow(node.children, { ...ctx, width })
    }
    default:
      return componentHtml(node, ctx)
  }
}

function renderBlock(node, ctx) {
  switch (node.type) {
    case 'paragraph':
      return paragraphHtml(node, ctx)
    case 'heading':
      return headingHtml(node, ctx)
    case 'list':
      return listHtml(node, ctx)
    case 'blockquote':
      return blockquoteHtml(node, ctx)
    case 'code':
      return codeHtml(node, ctx)
    case 'math':
      return mathHtml(node, ctx)
    case 'table':
      return tableHtml(node, ctx)
    case 'thematicBreak':
      return '<hr>'
    case 'html':
      return node.value
    case 'containerDirective':
      return directiveHtml(node, ctx)
    case 'definition':
      return ''
    case 'floatGroup':
      return `<div class="bk-float-group">${flowWithNotes(node.children, ctx, renderBlock)}</div>`
    default:
      ctx.fail(node, `unsupported block ${node.type}`)
      return ''
  }
}

function noteHtml(note, ctx) {
  const children = note.node.children
  const body = children.length === 1 && children[0].type === 'paragraph' ? renderPhrasing(children[0].children, ctx) : renderFlow(children, ctx)
  return `<div class="bk-sn" id="sn-${note.number}" data-note="${note.number}"><span class="bk-sn-num">${note.number}</span><div class="bk-sn-body">${body}</div></div>`
}

function flowWithNotes(children, ctx, renderChild) {
  let out = ''
  for (const child of children) {
    const sink = []
    const inner = { ...ctx, sink }
    out += renderChild(child, inner)
    for (const note of sink) out += noteHtml(note, { ...ctx, sink: [] })
  }
  return out
}

function isFloatParagraph(node) {
  const image = node?.type === 'paragraph' && soleImage(node)
  return Boolean(image && image.attributes?.float)
}

function groupFloats(children) {
  const grouped = []
  for (let index = 0; index < children.length; index++) {
    const node = children[index]
    const next = children[index + 1]
    if (isFloatParagraph(node) && next?.type === 'paragraph' && !soleImage(next)) {
      grouped.push({ type: 'floatGroup', children: [node, next], position: node.position })
      index++
    } else grouped.push(node)
  }
  return grouped
}

export function renderFlow(children, ctx) {
  return flowWithNotes(groupFloats(children), ctx, renderBlock)
}

export function renderInlineNodes(nodes, ctx) {
  return renderPhrasing(nodes, ctx)
}

export function renderNodes(nodes, ctx) {
  return renderFlow(nodes, ctx)
}

export { parseAttributes }
