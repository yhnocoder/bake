import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { startServer } from './serve.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const fixture = process.argv.includes('--fixture')
const outArgument = process.argv.find((argument) => argument.startsWith('--out='))
const distDir = join(root, fixture ? 'dist-fixture' : 'dist')
const shotsDir = outArgument ? outArgument.slice(6) : join(root, 'shots')
const widths = [1440, 1024, 375]
const themes = ['light', 'dark']

function pages(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === 'assets' ? [] : pages(path)
    return entry.name === 'index.html' ? [path] : []
  })
}

function executablePath() {
  const base = '/opt/pw-browsers'
  if (!existsSync(base)) return undefined
  const folder = readdirSync(base).find((name) => /^chromium-\d+$/.test(name) && statSync(join(base, name)).isDirectory())
  const candidate = folder && join(base, folder, 'chrome-linux', 'chrome')
  return candidate && existsSync(candidate) ? candidate : undefined
}

mkdirSync(shotsDir, { recursive: true })
const server = await startServer({ dir: distDir, listen: 0 })
const port = server.address().port
const browser = await chromium.launch({ executablePath: executablePath() })
const problems = []
try {
  for (const file of pages(distDir)) {
    const path = relative(distDir, file).replace(/index\.html$/, '')
    const name = path.replace(/\/$/, '').replaceAll('/', '_') || 'index'
    for (const width of widths) {
      for (const theme of themes) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, deviceScaleFactor: 1 })
        const page = await context.newPage()
        const label = `${path || '/'} ${width} ${theme}`
        page.on('console', (message) => {
          if (message.type() === 'error') problems.push(`${label}: console error: ${message.text()}`)
        })
        page.on('pageerror', (error) => problems.push(`${label}: page error: ${error.message}`))
        page.on('requestfailed', (request) => problems.push(`${label}: request failed: ${request.url()}`))
        page.on('response', (response) => {
          if (response.status() >= 400) problems.push(`${label}: HTTP ${response.status()} ${response.url()}`)
        })
        await page.goto(`http://127.0.0.1:${port}/${path}`, { waitUntil: 'networkidle' })
        await page.evaluate(async () => {
          await document.fonts.ready
          for (let y = 0; y < document.body.scrollHeight; y += 700) {
            scrollTo(0, y)
            await new Promise((resolve) => setTimeout(resolve, 40))
          }
          scrollTo(0, 0)
          await new Promise((resolve) => setTimeout(resolve, 300))
        })
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        if (overflow > 0) problems.push(`${label}: page scrolls horizontally by ${overflow}px`)
        await page.screenshot({ path: join(shotsDir, `${name}-${width}-${theme}.png`), fullPage: true })
        await context.close()
      }
    }
  }
} finally {
  await browser.close()
  server.close()
}
for (const problem of problems) console.error(`FAIL ${problem}`)
console.log(`Screenshots in ${relative(root, shotsDir) || shotsDir}/`)
if (problems.length) process.exit(1)
