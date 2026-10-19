import { visit, SKIP } from 'unist-util-visit'

const phrasingParents = new Set(['paragraph', 'heading', 'tableCell', 'emphasis', 'strong', 'delete', 'link', 'linkReference', 'mark'])
const citation = /\[(@[^\]\s;]+(?:\s*;\s*@[^\]\s;]+)*)\]/g
const eqref = /\\eqref\{([^}]+)\}/g
const eqrefOnly = /^\s*\\eqref\{([^}]+)\}\s*$/
const imageAttributes = /^\{([^}]*)\}/
const paragraphAnchor = /\s*\^([A-Za-z0-9][A-Za-z0-9_-]*)\s*$/
const headingAttributes = /\s*\{([^{}]*)\}\s*$/

export function pointAt(node, offset) {
  const start = node.position?.start
  if (!start) return undefined
  const before = node.value.slice(0, offset)
  const lines = before.split('\n')
  if (lines.length === 1) return { line: start.line, column: start.column + offset, offset: start.offset + offset }
  return { line: start.line + lines.length - 1, column: lines.at(-1).length + 1 }
}

function at(node, offset) {
  const start = pointAt(node, offset)
  return start ? { start, end: start } : node.position
}

export function parseAttributes(text) {
  const attributes = {}
  const pattern = /([#.])([^\s"=]+)|([A-Za-z_][\w-]*)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?/g
  let rest = text
  for (const match of text.matchAll(pattern)) {
    rest = rest.replace(match[0], '')
    if (match[1] === '#') attributes.id = match[2]
    else if (match[1] === '.') attributes.class = [attributes.class, match[2]].filter(Boolean).join(' ')
    else attributes[match[3]] = match[4] ?? match[5] ?? match[6] ?? ''
  }
  return rest.trim() === '' ? attributes : null
}

function mergeText(children) {
  const merged = []
  for (const child of children) {
    const last = merged.at(-1)
    if (child.type === 'text' && last?.type === 'text') {
      last.value += child.value
      if (last.position && child.position) last.position = { start: last.position.start, end: child.position.end }
    } else merged.push({ ...child })
  }
  return merged
}

function splitText(children, pattern, make) {
  const out = []
  for (const child of children) {
    if (child.type !== 'text') {
      out.push(child)
      continue
    }
    let last = 0
    for (const match of child.value.matchAll(pattern)) {
      if (match.index > last) out.push({ type: 'text', value: child.value.slice(last, match.index), position: at(child, last) })
      out.push(make(match, at(child, match.index)))
      last = match.index + match[0].length
    }
    if (last === 0) out.push(child)
    else if (last < child.value.length) out.push({ type: 'text', value: child.value.slice(last), position: at(child, last) })
  }
  return out
}

function wrapMarks(children) {
  const tokens = splitText(children, /==/g, (_, position) => ({ type: 'markDelimiter', position }))
  const out = []
  let open = -1
  for (const token of tokens) {
    if (token.type !== 'markDelimiter') {
      out.push(token)
      continue
    }
    if (open === -1) {
      open = out.length
      out.push(token)
      continue
    }
    const inner = out.splice(open)
    inner.shift()
    out.push({ type: 'mark', children: inner, position: token.position })
    open = -1
  }
  return mergeText(out.map((node) => (node.type === 'markDelimiter' ? { type: 'text', value: '==', position: node.position } : node)))
}

function transformPhrasing(parent) {
  let children = mergeText(parent.children)
  children = children.map((child, index) => {
    if (child.type !== 'image') return child
    const next = children[index + 1]
    const match = next?.type === 'text' && imageAttributes.exec(next.value)
    if (!match) return child
    const attributes = parseAttributes(match[1])
    if (!attributes) return child
    next.value = next.value.slice(match[0].length)
    return { ...child, attributes, attributesPosition: next.position }
  })
  children = children.filter((child) => child.type !== 'text' || child.value !== '')
  children = wrapMarks(children)
  children = splitText(children, citation, (match, position) => ({
    type: 'cite',
    keys: match[1].split(';').map((key) => key.trim().slice(1)),
    position,
  }))
  children = splitText(children, eqref, (match, position) => ({ type: 'eqref', name: match[1], position }))
  children = children.map((child) => {
    if (child.type !== 'inlineMath') return child
    const match = eqrefOnly.exec(child.value)
    return match ? { type: 'eqref', name: match[1], position: child.position } : child
  })
  children.forEach((child, index) => {
    const previous = children[index - 1]
    if (child.type === 'eqref' && previous?.type === 'text' && /式\s*$/.test(previous.value)) previous.value = previous.value.replace(/式\s*$/, '')
  })
  parent.children = children.filter((child) => child.type !== 'text' || child.value !== '')
  for (const child of parent.children) if (child.children && phrasingParents.has(child.type)) transformPhrasing(child)
}

function readHeadingAttributes(node, source, fail) {
  const start = node.position.start.offset
  const raw = source.slice(start, node.position.end.offset)
  const match = headingAttributes.exec(raw)
  if (!match) return
  const attributes = parseAttributes(match[1])
  if (!attributes) return
  const cut = start + match.index
  node.children = node.children.flatMap((child) => {
    const childStart = child.position?.start.offset ?? 0
    const childEnd = child.position?.end.offset ?? 0
    if (childStart >= cut) return []
    if (childEnd <= cut) return [child]
    if (child.type === 'text') return [{ ...child, value: child.value.slice(0, cut - childStart) }]
    return [child]
  })
  const last = node.children.at(-1)
  if (last?.type === 'text') last.value = last.value.replace(/\s+$/, '')
  if (/\$/.test(attributes.toc ?? '')) fail(node, `toc text cannot contain math; write the symbol in Unicode instead: ${attributes.toc}`)
  node.attributes = attributes
}

export function transformInline(tree, source, fail) {
  visit(tree, (node) => {
    if (node.type === 'heading') readHeadingAttributes(node, source, fail)
    if (node.type === 'paragraph') {
      const last = node.children.at(-1)
      const match = last?.type === 'text' && paragraphAnchor.exec(last.value)
      if (match && (match.index > 0 || node.children.length > 1)) {
        last.value = last.value.slice(0, match.index)
        node.anchor = match[1]
        node.anchorPosition = at(last, match.index)
      }
    }
    if (phrasingParents.has(node.type) && node.type !== 'mark') {
      transformPhrasing(node)
      return SKIP
    }
  })
}
