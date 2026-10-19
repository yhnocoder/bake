import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkDirective from 'remark-directive'
import remarkFrontmatter from 'remark-frontmatter'
import { parse as parseYaml } from 'yaml'
import { visit, SKIP } from 'unist-util-visit'

export const widthDirective = 'bkwidth'
export const pipeInMath = ''
const namelessDirective = /^(\s*(?:>\s*)*)(:{3,})\{/gm

function protectTablePipes(source) {
  return source
    .split('\n')
    .map((line) => {
      if (!/^\s*(?:>\s*)*\|/.test(line)) return line
      let inside = false
      let out = ''
      for (let i = 0; i < line.length; i++) {
        const char = line[i]
        if (char === '\\' && i + 1 < line.length) {
          out += char + line[i + 1]
          i++
          continue
        }
        if (char === '$') inside = !inside
        out += inside && char === '|' ? pipeInMath : char
      }
      return out
    })
    .join('\n')
}

function restoreUnsupportedDirectives(tree, source) {
  visit(tree, (node, index, parent) => {
    if (!parent) return
    if (node.type === 'textDirective') {
      parent.children[index] = { type: 'text', value: source.slice(node.position.start.offset, node.position.end.offset), position: node.position }
      return SKIP
    }
    if (node.type === 'leafDirective') {
      const text = { type: 'text', value: source.slice(node.position.start.offset, node.position.end.offset), position: node.position }
      parent.children[index] = { type: 'paragraph', children: [text], position: node.position }
      return SKIP
    }
  })
}

function restorePipes(tree) {
  visit(tree, ['math', 'inlineMath'], (node) => {
    node.value = node.value.replaceAll(pipeInMath, '|')
  })
}

export function parseMarkdown(raw) {
  const source = protectTablePipes(raw.replace(namelessDirective, `$1$2${widthDirective}{`))
  const tree = unified().use(remarkParse).use(remarkGfm, { singleTilde: false }).use(remarkMath).use(remarkDirective).use(remarkFrontmatter).parse(source)
  restoreUnsupportedDirectives(tree, source)
  restorePipes(tree)
  const yamlNode = tree.children.find((node) => node.type === 'yaml')
  const frontmatter = yamlNode ? (parseYaml(yamlNode.value) ?? {}) : {}
  tree.children = tree.children.filter((node) => node.type !== 'yaml')
  return { tree, source, frontmatter, frontmatterNode: yamlNode }
}
