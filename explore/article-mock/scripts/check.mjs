import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { startServer } from './serve.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = join(root, 'dist-check')
const results = []

function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : `: ${detail}`}`)
}

function build(args) {
  return spawnSync(process.execPath, [join(root, 'scripts/build.mjs'), ...args], { cwd: root, encoding: 'utf8' })
}

const good = build(['--fixture', `--out=${outDir}`])
check('fixture builds', good.status === 0, good.stderr)
const alpha = readFileSync(join(outDir, '2026-09/syntax-fixture/index.html'), 'utf8')
const beta = readFileSync(join(outDir, '2026-07/matrix-fixture/index.html'), 'utf8')

check('list-table cell images stay inline', alpha.includes('<td><img class="bk-inline-img"') && !/<td><figure/.test(alpha))
check('heading attributes after inline math keep the id', beta.includes('<h2 id="jacobian-shape">') && beta.includes('"title":"雅可比矩阵的形状"'))
check('a 式 written before \\eqref is part of the link', alpha.includes('由<a class="bk-eqref" href="#eq-pre" data-eq="eq-pre">式 (1)</a>'))
check('math in a fold title is typeset', /bk-fold-title">展开了解：为什么期望恰好是 <span class="bk-m"><mjx-container/.test(alpha))
check('recap is not in the article body', !alpha.slice(alpha.indexOf('<article'), alpha.indexOf('</article>')).includes('每个神经元只看自己的预激活值'))
check('citations are numbered by first use', alpha.includes('data-ref="shazeer2020">1</a>') && alpha.includes('data-ref="gelu">2</a>'))
check('every asset URL is relative', !/(?:src|href)="\/(?!\/)/.test(alpha + beta))
const embedded = alpha.slice(alpha.indexOf('class="bk-embed"'), alpha.indexOf('有了这条规则'))
check('embedded content has no sidenotes', embedded.includes('每一层的梯度') && !embedded.includes('bk-ref') && !embedded.includes('bk-sn'))

const broken = build(['--content=scripts/fixture/broken/posts', '--components=scripts/fixture/components', `--out=${join(outDir, 'broken')}`])
check('broken fixture fails the build', broken.status === 1)
const expectedErrors = [
  'one/index.md:9:1 :::recap must be inside a ### section',
  'one/index.md:13:1 toc text cannot contain math',
  'one/index.md:13:1 anchor #first is already used in this article',
  'one/index.md:15:1 fixture-curve: fn must be one of relu, tanh, got "gelu"',
  'one/index.md:18:1 fixture-curve: range=40 is above the maximum 10',
  'one/index.md:21:1 fixture-curve: range must be a number, got "abc"',
  'one/index.md:21:1 fixture-curve: unknown parameter colour',
  'one/index.md:24:1 unknown component no-such-component',
  'one/index.md:27:2 link target /2026-09/broken-two/#missing does not exist',
  'one/index.md:27:41 link target /2026-01/nothing/ does not exist',
  'one/index.md:29:4 citation [@unknown] has no item in :::references',
  'one/index.md:29:18 \\eqref target eq:none is not defined',
  'one/index.md:29:36 footnote [^nothing] has no definition',
  'one/index.md:32:1 an article cannot embed itself',
  'one/index.md:38:1 list-table row 2 has 1 cells; the first row has 2',
]
for (const expected of expectedErrors) check(`build error: ${expected}`, broken.stderr.includes(expected), broken.stderr)
const reported = broken.stderr.split('\n').filter((line) => /:\d+:\d+ /.test(line))
check('build errors are reported once each', new Set(reported).size === reported.length)

const server = await startServer({ dir: outDir, listen: 0 })
const port = server.address().port
const browser = await chromium.launch()
async function open(width, init = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  const errors = []
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
  page.on('pageerror', (error) => errors.push(error.message))
  if (init.toc) await page.addInitScript((toc) => localStorage.setItem('bk-toc', toc), init.toc)
  await page.goto(`http://127.0.0.1:${port}/${init.path ?? '2026-09/syntax-fixture/'}`, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(200)
  return { page, errors }
}
try {
  const { page, errors } = await open(1440)
  const widths = await page.evaluate(() =>
    [...document.querySelectorAll('.bk-math')].map((block) => [block.dataset.resolved ?? '', Math.round(block.getBoundingClientRect().width)]),
  )
  check(
    'an overflowing display formula resolves to wide',
    widths.some(([resolved, width]) => resolved === 'wide' && width === 1100),
    JSON.stringify(widths),
  )
  check(
    'a display formula that fits stays body width',
    widths.some(([resolved, width]) => resolved === '' && width === 820),
    JSON.stringify(widths),
  )
  const leftClip = await page.evaluate(() =>
    [...document.querySelectorAll('.bk-math mjx-container')].some(
      (box) => box.querySelector('svg').getBoundingClientRect().left < box.getBoundingClientRect().left - 1,
    ),
  )
  check('display formulas never overflow to the left', !leftClip)
  const offsets = await page.evaluate(() =>
    [...document.querySelectorAll('.bk-notes-layer .bk-sn')].map((note) => {
      const ref = document.querySelector(`.bk-ref[data-note="${note.dataset.note}"]`)
      return note.getBoundingClientRect().top - ref.getBoundingClientRect().top
    }),
  )
  check('the first sidenote aligns with its reference line', Math.abs(offsets[0]) < 14, JSON.stringify(offsets))
  check(
    'later sidenotes never sit above their reference line',
    offsets.every((offset) => offset > -14),
    JSON.stringify(offsets),
  )
  const slot = await page.evaluate(() => getComputedStyle(document.querySelector('.bk-slot[data-component="fixture-curve"]')).height)
  check('a component slot keeps its declared height on desktop', slot === '300px', slot)
  const foldOverflow = await page.evaluate(() => {
    for (const details of document.querySelectorAll('.bk-fold')) details.open = true
    return [...document.querySelectorAll('.bk-fold-body :is(.bk-fig, .bk-block)')].map((element) => {
      const body = element.closest('.bk-fold-body').getBoundingClientRect()
      return Math.round(element.getBoundingClientRect().right - body.right)
    })
  })
  check('figures inside a fold stay within the fold', foldOverflow.length > 0 && foldOverflow.every((overflow) => overflow <= 0), JSON.stringify(foldOverflow))
  const noteMath = await page.evaluate(() =>
    [...document.querySelectorAll('.bk-tn-note-inner mjx-container > svg')].filter((svg) => svg.getBoundingClientRect().width > 0).map((svg) => {
      const column = svg.closest('.bk-tn-note-inner').getBoundingClientRect()
      const rect = svg.getBoundingClientRect()
      const [, , width, height] = svg.getAttribute('viewBox').split(' ').map(Number)
      return { overflow: Math.round(rect.right - column.right), ratio: rect.width / rect.height / (width / height) }
    }),
  )
  check(
    'formulas in T1 notes fit the note column',
    noteMath.length >= 3 && noteMath.every((item) => item.overflow <= 0),
    JSON.stringify(noteMath),
  )
  check(
    'formulas in T1 notes keep their aspect ratio',
    noteMath.every((item) => Math.abs(item.ratio - 1) < 0.03),
    JSON.stringify(noteMath),
  )
  await page.evaluate(() => scrollTo(0, document.getElementById('no-sections').getBoundingClientRect().top + scrollY - 100))
  await page.waitForTimeout(600)
  const chapterMark = await page.evaluate(() => {
    const part = [...document.querySelectorAll('.bk-tn-part')].find((element) => element.textContent.includes('没有小节的章'))
    const probe = document.createElement('span')
    probe.style.color = 'var(--accent)'
    document.body.append(probe)
    const accent = getComputedStyle(probe).color
    probe.remove()
    const bar = getComputedStyle(part, '::before')
    return { color: getComputedStyle(part).color, accent, bar: bar.backgroundColor, barWidth: bar.width }
  })
  check(
    'a current chapter without sections is marked current in T1',
    chapterMark.color === chapterMark.accent && chapterMark.bar === chapterMark.accent && chapterMark.barWidth === '2px',
    JSON.stringify(chapterMark),
  )
  check('no console errors at 1440', errors.length === 0, errors.join(' | '))
  await page.close()

  for (const width of [1440, 1024]) {
    const matrix = await open(width, { path: '2026-07/matrix-fixture/' })
    const lines = await matrix.page.evaluate(() => {
      const cell = [...document.querySelectorAll('.bk-list-table th')].find((element) => element.textContent.includes('输出'))
      const range = document.createRange()
      range.selectNodeContents(cell)
      return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size
    })
    check(`a short list-table header stays on one line at ${width}`, lines === 1, String(lines))
    await matrix.page.close()
  }

  const resting = await open(1024, { toc: 'ticks' })
  await resting.page.mouse.move(2, 2)
  await resting.page.evaluate(() => scrollBy(0, 600))
  await resting.page.waitForTimeout(800)
  const restingExpanded = await resting.page.evaluate(() => document.querySelector('.bk-tk').classList.contains('is-expanded'))
  check('T4 stays collapsed when the pointer rests outside the tick column', !restingExpanded)
  await resting.page.close()

  const ticks = await open(1024, { toc: 'ticks' })
  await ticks.page.evaluate(() => document.getElementById('公式与代码').scrollIntoView())
  await ticks.page.waitForTimeout(200)
  const box = await ticks.page.locator('.bk-tk-col').boundingBox()
  await ticks.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 })
  await ticks.page.waitForTimeout(800)
  const hiddenRows = await ticks.page.evaluate(() => [...document.querySelectorAll('.bk-tk-sub')].filter((row) => row.offsetParent === null).length)
  const expanded = await ticks.page.evaluate(() => document.querySelector('.bk-tk').classList.contains('is-expanded'))
  check('T4 expands after resting on the tick column', expanded)
  check('T4 shows only the current chapter sections', hiddenRows > 0, String(hiddenRows))
  await ticks.page.close()

  const phone = await open(375)
  const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('no horizontal page scroll at 375', overflow === 0, String(overflow))
  await phone.page.click('.bk-ref a')
  const open375 = await phone.page.evaluate(() => getComputedStyle(document.getElementById('sn-1')).display)
  check('a tapped sidenote number opens the note under its paragraph at 375', open375 === 'block', open375)
  check('no console errors at 375', phone.errors.length === 0, phone.errors.join(' | '))
  await phone.page.close()
} finally {
  await browser.close()
  server.close()
}

const failed = results.filter((result) => !result.ok).length
console.log(`${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
