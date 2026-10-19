import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { clientConfig } from '../vite.config.js'
import { loadArticle, prepareArticle } from './render/article.js'
import { createComponentLoader } from './render/components.js'
import { report, hasErrors, printErrors } from './render/errors.js'
import { createMathRenderer } from './render/math.js'
import { parsePreamble } from './render/preamble.js'
import { articlePage, indexPage } from './render/page.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const fixture = process.argv.includes('--fixture')
const option = (name) => process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3)
const contentDir = resolve(root, option('content') ?? (fixture ? 'scripts/fixture/posts' : 'content/posts'))
const componentsDir = resolve(root, option('components') ?? (fixture ? 'scripts/fixture/components' : 'components'))
const outDir = resolve(root, option('out') ?? (fixture ? 'dist-fixture' : 'dist'))
const preambleFile = join(root, 'preamble.sty')

function findArticles(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return findArticles(path)
    return entry.name === 'index.md' ? [path] : []
  })
}

function stop() {
  printErrors()
  process.exit(1)
}

async function loadPreamble(math) {
  const { statements, errors } = parsePreamble(readFileSync(preambleFile, 'utf8'))
  for (const error of errors) report(preambleFile, { line: error.line, column: 1 }, error.message)
  for (const statement of statements) {
    try {
      await math.defineMacros(statement.tex)
    } catch (error) {
      report(preambleFile, { line: statement.line, column: 1 }, `TeX error: ${error.message}`)
    }
  }
}

function copyArticleFiles(article) {
  const target = join(outDir, article.path)
  mkdirSync(target, { recursive: true })
  for (const name of readdirSync(article.dir)) {
    if (name === 'index.md') continue
    const source = join(article.dir, name)
    if (statSync(source).isDirectory() && existsSync(join(source, 'index.md'))) continue
    cpSync(source, join(target, name), { recursive: true })
  }
}

function clientAssets() {
  const manifest = JSON.parse(readFileSync(join(outDir, '.vite/manifest.json'), 'utf8'))
  const entry = Object.values(manifest).find((chunk) => chunk.isEntry)
  return { js: entry.file, css: entry.css ?? [] }
}

const started = performance.now()
const math = createMathRenderer()
await loadPreamble(math)

const articles = findArticles(contentDir).map((file) => loadArticle(file, report))
const site = new Map()
for (const article of articles) {
  const other = site.get(article.url)
  if (other) report(article.file, article.frontmatterNode, `URL ${article.url} is already used by ${relative(root, other.file)}`)
  else site.set(article.url, article)
}

const components = await createComponentLoader(root, componentsDir)
try {
  for (const article of articles) await prepareArticle(article, { math, components, fail: report })
} finally {
  await components.close()
}

const pages = articles.map((article) => {
  const ctx = {
    article,
    host: article,
    site,
    mode: 'page',
    sink: [],
    state: { previews: new Map(), shownNotes: new Set(), embedRanges: [] },
    fail: (node, message) => report(article.file, node, message),
    failIn: (file, node, message) => report(file, node, message),
  }
  return { article, ctx }
})

const rendered = pages.map(({ article, ctx }) => ({ article, page: articlePage(article, ctx) }))
if (hasErrors()) stop()

await build(clientConfig({ components: componentsDir, outDir }))
const assets = clientAssets()
writeFileSync(join(outDir, 'assets', 'mathjax.css'), math.styleSheet())
assets.css.unshift('assets/mathjax.css')
const sorted = [...articles].sort((a, b) => b.date.localeCompare(a.date))
for (const { article, page } of rendered) {
  copyArticleFiles(article)
  writeFileSync(join(outDir, article.path, 'index.html'), page.html(math.glyphDefinitions(page.content), assets))
}
writeFileSync(join(outDir, 'index.html'), indexPage(sorted, assets))
console.log(
  `Built ${articles.length} article${articles.length === 1 ? '' : 's'} into ${relative(root, outDir)}/ in ${Math.round(performance.now() - started)} ms`,
)
