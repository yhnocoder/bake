import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import GithubSlugger from 'github-slugger'
import { toString } from 'mdast-util-to-string'
import { visit, SKIP, EXIT } from 'unist-util-visit'
import { parseMarkdown, widthDirective } from './parse.js'
import { pointAt, transformInline } from './inline.js'
import { highlight, isKnownLanguage } from './code.js'
import { resolveComponent } from './components.js'

const builtinDirectives = new Set(['aside', 'fold', 'references', 'list-table', 'embed', 'recap', widthDirective])
const labelPattern = /\\label\{([^}]*)\}/g
const slugPattern = /^[a-z0-9-]+$/
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/

export function equationId(name) {
  return name.replace(/[^A-Za-z0-9_-]/g, '-')
}

function countWords(tree) {
  let text = ''
  visit(tree, ['text', 'inlineCode'], (node) => {
    text += node.value + ' '
  })
  const han = text.match(/[㐀-鿿豈-﫿]/g)?.length ?? 0
  const words = text.replace(/[㐀-鿿豈-﫿]/g, ' ').match(/[A-Za-z0-9]+/g)?.length ?? 0
  return han + words
}

function readFrontmatter(article, fail) {
  const { frontmatter } = article
  for (const field of ['title', 'slug', 'date']) if (!frontmatter[field]) fail(article.frontmatterNode, `front matter is missing ${field}`)
  const slug = String(frontmatter.slug ?? '')
  if (slug && !slugPattern.test(slug)) fail(article.frontmatterNode, `slug may only contain lowercase letters, digits and -: ${slug}`)
  const date = frontmatter.date instanceof Date ? frontmatter.date.toISOString().slice(0, 10) : String(frontmatter.date ?? '')
  const match = datePattern.exec(date)
  if (frontmatter.date && !match) fail(article.frontmatterNode, `date must be YYYY-MM-DD, got ${date}`)
  const month = match ? `${match[1]}-${match[2]}` : '0000-00'
  const toc = frontmatter.toc ?? 'notes'
  if (!['notes', 'tabs', 'dots', 'ticks'].includes(toc)) fail(article.frontmatterNode, `toc must be notes, tabs, dots or ticks, got ${toc}`)
  Object.assign(article, {
    title: String(frontmatter.title ?? ''),
    summary: String(frontmatter.summary ?? ''),
    tags: frontmatter.tags ?? [],
    date,
    slug,
    toc,
    path: `${month}/${slug}`,
    url: `/${month}/${slug}/`,
  })
}

function collectStructure(article, fail) {
  const { tree } = article
  const slugger = new GithubSlugger()
  const explicit = new Set()
  visit(tree, 'heading', (node) => {
    if (node.attributes?.id) explicit.add(node.attributes.id)
  })
  const anchors = new Map()
  function addAnchor(id, entry, node) {
    if (anchors.has(id)) fail(node, `anchor #${id} is already used in this article`)
    else anchors.set(id, entry)
  }
  const chapters = []
  let chapter = null
  let section = null
  tree.children.forEach((node, index) => {
    if (node.type === 'heading') {
      if (node.depth === 1) fail(node, 'use ## for chapters; the title comes from the front matter')
      const text = toString(node).trim()
      let id = node.attributes?.id
      if (!id) {
        do id = slugger.slug(text)
        while (explicit.has(id))
      }
      node.id = id
      node.text = text
      for (const name of Object.keys(node.attributes ?? {})) {
        if (!['id', 'toc', 'width'].includes(name)) fail(node, `unknown heading attribute ${name}`)
      }
      if (node.depth === 2) {
        chapter = { node, index, number: String(chapters.length + 1).padStart(2, '0'), sections: [] }
        chapters.push(chapter)
        section = null
        node.chapter = chapter
      } else if (node.depth === 3) {
        if (!chapter) fail(node, '### must follow a ## chapter')
        section = { node, index, chapter, recap: null, number: chapter ? chapter.sections.length + 1 : 0 }
        chapter?.sections.push(section)
        node.section = section
      }
      addAnchor(id, { kind: 'heading', node, index, chapter: node.depth === 2 ? chapter : chapter, section: node.depth === 3 ? section : null }, node)
      return
    }
    if (node.type === 'containerDirective' && node.name === 'recap') {
      if (!section) fail(node, ':::recap must be inside a ### section')
      else if (section.recap) fail(node, 'a ### section can have only one :::recap')
      else section.recap = node
    }
    visit(node, (inner) => {
      if (inner.type === 'paragraph' && inner.anchor) {
        inner.id = inner.anchor
        addAnchor(inner.anchor, { kind: 'paragraph', node: inner, index, topLevel: inner === node, chapter, section }, inner.anchorPosition ?? inner)
      }
    })
    node.chapter = chapter
    node.section = section
  })
  visit(tree, (node, index, parent) => {
    if (node.type === 'containerDirective' && node.name === 'recap' && parent !== tree) fail(node, ':::recap must be a top-level block inside a ### section')
  })
  article.chapters = chapters
  article.anchors = anchors
}

function numberEquations(article, fail) {
  const labels = new Map()
  let count = 0
  visit(article.tree, 'math', (node) => {
    const names = [...node.value.matchAll(labelPattern)].map((match) => match[1])
    if (names.length === 0) return
    node.labels = []
    for (const name of names) {
      const number = ++count
      if (labels.has(name)) fail(node, `duplicate equation label ${name}`)
      else labels.set(name, { id: equationId(name), number, node })
      node.labels.push({ name, number, id: equationId(name) })
    }
    let index = 0
    node.tex = node.value.replace(labelPattern, () => `\\tag{${node.labels[index++].number}}`)
  })
  article.equations = labels
  for (const { id, node } of labels.values()) {
    if (!article.anchors.has(id)) article.anchors.set(id, { kind: 'equation', node, index: article.tree.children.indexOf(node) })
  }
  visit(article.tree, ['math', 'inlineMath'], (node) => {
    const source = node.tex ?? node.value
    node.tex = source
      .replace(/\\eqref\{([^}]*)\}/g, (whole, name) => {
        const label = labels.get(name)
        if (!label) fail(node, `\\eqref target ${name} is not defined`)
        return label ? `\\text{(${label.number})}` : whole
      })
      .replace(/\\ref\{([^}]*)\}/g, (whole, name) => {
        const label = labels.get(name)
        if (!label) fail(node, `\\ref target ${name} is not defined`)
        return label ? `\\text{${label.number}}` : whole
      })
  })
  visit(article.tree, 'eqref', (node) => {
    const label = labels.get(node.name)
    if (!label) fail(node, `\\eqref target ${node.name} is not defined`)
    else node.label = label
  })
}

function numberCitations(article, fail) {
  const references = new Map()
  visit(article.tree, 'containerDirective', (node) => {
    if (node.name !== 'references') return
    if (article.referencesNode) fail(node, 'an article can have only one :::references block')
    article.referencesNode = node
    const list = node.children.find((child) => child.type === 'list')
    if (!list || node.children.length !== 1) fail(node, ':::references must contain one list with items "- [@key] text"')
    for (const item of list?.children ?? []) {
      const paragraph = item.children[0]
      const first = paragraph?.children?.find((child) => !(child.type === 'text' && child.value.trim() === ''))
      if (first?.type !== 'cite' || first.keys.length !== 1) {
        fail(item, 'each reference item must start with [@key]')
        continue
      }
      const index = paragraph.children.indexOf(first)
      paragraph.children.splice(0, index + 1)
      const text = paragraph.children[0]
      if (text?.type === 'text') text.value = text.value.replace(/^\s+/, '')
      if (references.has(first.keys[0])) fail(item, `reference ${first.keys[0]} is listed twice`)
      references.set(first.keys[0], { key: first.keys[0], item, number: 0 })
    }
    return SKIP
  })
  let count = 0
  visit(article.tree, (node) => {
    if (node.type === 'containerDirective' && node.name === 'references') return SKIP
    if (node.type !== 'cite') return
    for (const key of node.keys) {
      const reference = references.get(key)
      if (!reference) {
        fail(node, `citation [@${key}] has no item in :::references`)
        continue
      }
      if (!reference.number) reference.number = ++count
    }
  })
  for (const reference of references.values()) if (!reference.number) reference.number = ++count
  article.references = references
}

function numberFootnotes(article, fail) {
  const definitions = new Map()
  visit(article.tree, 'footnoteDefinition', (node, index, parent) => {
    if (definitions.has(node.identifier)) fail(node, `footnote [^${node.label}] is defined twice`)
    definitions.set(node.identifier, { node, number: 0 })
    parent.children.splice(index, 1)
    return index
  })
  for (const { node } of definitions.values()) {
    visit(node, 'footnoteReference', (reference) => fail(reference, 'a sidenote cannot contain a footnote reference'))
  }
  visit(article.tree, 'text', (node) => {
    for (const match of node.value.matchAll(/\[\^([^\]\s]+)\]/g))
      fail({ position: { start: pointAt(node, match.index) } }, `footnote [^${match[1]}] has no definition`)
  })
  let count = 0
  visit(article.tree, 'footnoteReference', (node) => {
    const definition = definitions.get(node.identifier)
    if (!definition) {
      fail(node, `footnote [^${node.label}] has no definition`)
      return
    }
    if (!definition.number) definition.number = ++count
    node.note = definition
  })
  article.footnotes = definitions
}

export function loadArticle(file, fail) {
  const raw = readFileSync(file, 'utf8')
  const parsed = parseMarkdown(raw)
  const article = { file, dir: dirname(file), ...parsed }
  const failAt = (node, message) => fail(file, node, message)
  readFrontmatter(article, failAt)
  transformInline(article.tree, article.source, failAt)
  numberFootnotes(article, failAt)
  collectStructure(article, failAt)
  numberEquations(article, failAt)
  numberCitations(article, failAt)
  article.words = countWords(article.tree)
  return article
}

function escapeText(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

async function titleWithMath(title, math, fail) {
  const parts = title.split(/\$([^$]+)\$/)
  let html = ''
  for (let index = 0; index < parts.length; index++) {
    if (index % 2 === 0) {
      html += escapeText(parts[index])
      continue
    }
    try {
      html += `<span class="bk-m">${await math.render(parts[index], false)}</span>`
    } catch (error) {
      fail(`TeX error in title: ${error.message}`)
    }
  }
  return html
}

export async function prepareArticle(article, { math, components, fail }) {
  const failAt = (node, message) => fail(article.file, node, message)
  const formulas = []
  const blocks = []
  const directives = []
  const roots = [article.tree, ...[...article.footnotes.values()].map((definition) => definition.node)]
  for (const root of roots) {
    visit(root, (node) => {
      if (node.type === 'math' || node.type === 'inlineMath') formulas.push(node)
      if (node.type === 'code') blocks.push(node)
      if (node.type === 'containerDirective') directives.push(node)
    })
  }
  await Promise.all(
    formulas.map(async (node) => {
      try {
        node.svg = await math.render(node.tex ?? node.value, node.type === 'math')
      } catch (error) {
        failAt(node, `TeX error: ${error.message}`)
        node.svg = ''
      }
    }),
  )
  for (const node of blocks) {
    if (!isKnownLanguage(node.lang)) {
      failAt(node, `unknown code language ${node.lang}`)
      continue
    }
    node.html = await highlight(node.value, node.lang)
  }
  for (const node of directives) {
    const title = node.attributes?.title
    if (title && title.includes('$')) node.titleHtml = await titleWithMath(title, math, (message) => failAt(node, message))
    if (builtinDirectives.has(node.name)) continue
    if (!node.name.includes('-')) {
      failAt(node, `unknown block :::${node.name}`)
      continue
    }
    const component = await components.load(node.name)
    if (!component) {
      failAt(node, `unknown component ${node.name}: no components/${node.name}.jsx or .js`)
      continue
    }
    node.component = resolveComponent(component, node.attributes, (message) => failAt(node, `${node.name}: ${message}`))
  }
}

export function findFirst(tree, type) {
  let found = null
  visit(tree, type, (node) => {
    found = node
    return EXIT
  })
  return found
}
