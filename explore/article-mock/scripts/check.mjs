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
check('math in a fold title is typeset', /bk-fold-title">展开了解：为什么期望恰好是 <span class="bk-m" data-tex="[^"]*"><mjx-container/.test(alpha))
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
  'one/index.md:41:1 fixture-curve: width must be body, wide, page, pixels such as 560px, or a percentage up to 100% such as 70%; got "120%"',
  'one/index.md:44:1 fixture-window: components/fixture-window.js uses the browser API window at the top level; the build reads params and layout in Node, so use it inside the component code',
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
  const narrowFrames = await page.evaluate(() => {
    const article = document.querySelector('.bk-article').getBoundingClientRect()
    return [...document.querySelectorAll('.bk-component[data-size]')].map((figure) => {
      const rect = figure.getBoundingClientRect()
      return { width: Math.round(rect.width), left: Math.round(rect.left - article.left), right: Math.round(article.right - rect.right) }
    })
  })
  check(
    'components with a pixel or percentage width are that wide and centred',
    narrowFrames.length === 2 && narrowFrames[0].width === 300 && narrowFrames[1].width === 410 && narrowFrames.every((frame) => Math.abs(frame.left - frame.right) <= 1),
    JSON.stringify(narrowFrames),
  )
  const fonts = await page.evaluate(async () => {
    const body = getComputedStyle(document.body).fontFamily
    const heading = getComputedStyle(document.querySelector('.bk-article h2')).fontFamily
    document.querySelector('.bk-sw-toggle').click()
    document.querySelector('.bk-sw-seg button[data-value="wenkai"]').click()
    const chosen = getComputedStyle(document.body).fontFamily
    document.querySelector('.bk-sw-seg button[data-value="sans"]').click()
    document.querySelector('.bk-sw-toggle').click()
    return { body, heading, chosen, stored: localStorage.getItem('bk-font') }
  })
  check(
    'the body font defaults to sans, headings use WenKai, and the setting switches the body to WenKai',
    !fonts.body.includes('WenKai') && fonts.heading.includes('WenKai') && fonts.chosen.includes('WenKai') && fonts.stored === null,
    JSON.stringify(fonts),
  )
  async function copyOf(select) {
    return page.evaluate((select) => {
      const range = document.createRange()
      const start = document.querySelector(select.start)
      const end = document.querySelector(select.end ?? select.start)
      range.setStartBefore(start)
      range.setEndAfter(end)
      getSelection().removeAllRanges()
      getSelection().addRange(range)
      const data = new DataTransfer()
      const event = new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      return { text: data.getData('text/plain'), html: data.getData('text/html'), prevented: event.defaultPrevented, toast: document.querySelector('.bk-toast')?.textContent ?? '' }
    }, select)
  }
  const paragraph = await copyOf({ start: '#neuron-input' })
  check(
    'copying a paragraph gives Markdown with TeX, footnotes and their text',
    paragraph.prevented &&
      paragraph.text.includes('$w_i$') &&
      paragraph.text.includes('[^1]') &&
      paragraph.text.includes('[^2]') &&
      paragraph.text.includes('[^1]: epilogue 是矩阵乘法内核里') &&
      paragraph.text.includes('[^2]: 两种做法：clamp 直接截断，soft-capping 用 $c \\cdot \\tanh(x/c)$'),
    paragraph.text,
  )
  check('copying shows the Markdown toast', paragraph.toast === '已复制为 Markdown', paragraph.toast)
  const intro = await copyOf({ start: '#intro', end: '#intro + p' })
  check(
    'copying a heading and paragraph drops the chapter number and keeps marks, links and emphasis',
    /^## 引言\n\n这一段/.test(intro.text) && intro.text.includes('==逐元素==') && intro.text.includes('[epilogue](https://en.wikipedia.org/wiki/Matrix_multiplication)') && intro.text.includes('**加粗**') && intro.text.includes('`act_fn`'),
    intro.text,
  )
  const component = await copyOf({ start: '.bk-component[data-size]' })
  check('copying a component gives its directive block', component.text === ':::fixture-curve{fn=tanh width=300px}\n窄组件的框宽 300px，在正文栏里居中。\n:::', component.text)
  const display = await copyOf({ start: '.bk-article .bk-math[data-tex]' })
  check('copying a display formula gives its TeX between $$ lines', /^\$\$\n[^$]+\n\$\$$/.test(display.text), display.text)
  await page.evaluate(() => getSelection().removeAllRanges())
  const tint = await page.evaluate(() => {
    const note = document.querySelector('.bk-notes-layer .bk-sn')
    note.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
    const ref = document.querySelector(`.bk-ref[data-note="${note.dataset.note}"]`)
    const block = ref.closest('p, li')
    return { tinted: block.classList.contains('bk-tinted'), transition: getComputedStyle(block).transitionDuration }
  })
  check('hovering a sidenote tints its paragraph with a transition', tint.tinted && tint.transition !== '0s', JSON.stringify(tint))
  check('no console errors at 1440', errors.length === 0, errors.join(' | '))
  await page.close()

  const middle = await open(1024)
  const drawerButton = await middle.page.evaluate(() => {
    const button = document.querySelector('.bk-toc-button')
    const settings = document.querySelector('.bk-sw-toggle').getBoundingClientRect()
    const rect = button.getBoundingClientRect()
    return { display: getComputedStyle(button).display, overlap: !(rect.bottom <= settings.top || settings.bottom <= rect.top || rect.right <= settings.left || settings.right <= rect.left) }
  })
  check('at 1024 the T1 notes open from a drawer button that does not overlap the settings button', drawerButton.display !== 'none' && !drawerButton.overlap, JSON.stringify(drawerButton))
  await middle.page.click('.bk-toc-button')
  await middle.page.waitForTimeout(400)
  const drawerNotes = await middle.page.evaluate(() => document.querySelectorAll('.bk-drawer .bk-tn-it').length)
  check('the drawer at 1024 shows the T1 notes', drawerNotes > 0, String(drawerNotes))
  await middle.page.close()

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
  await ticks.page.locator('.bk-tk-it').first().hover()
  await ticks.page.waitForTimeout(300)
  const tickPanel = await ticks.page.evaluate(() => {
    const column = document.querySelector('.bk-tk-col').getBoundingClientRect()
    const list = document.querySelector('.bk-tk-list').getBoundingClientRect()
    const focus = document.querySelector('.bk-tk-row.is-focus .bk-tk-link')?.textContent ?? ''
    return { gap: Math.round(list.left - column.right), focus, cards: [...document.querySelectorAll('.bk-toc-card')].filter((card) => !card.hidden).length }
  })
  check('the T4 panel opens beside the ticks and highlights the hovered tick', tickPanel.gap >= 0 && tickPanel.focus.length > 0 && tickPanel.cards === 0, JSON.stringify(tickPanel))
  await ticks.page.close()

  const phone = await open(375)
  const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('no horizontal page scroll at 375, and a long inline formula wraps', overflow === 0, String(overflow))
  await phone.page.click('.bk-ref a')
  const open375 = await phone.page.evaluate(() => getComputedStyle(document.getElementById('sn-1')).display)
  check('a tapped sidenote number opens the note under its paragraph at 375', open375 === 'block', open375)
  const placeholders = await phone.page.evaluate(() =>
    [...document.querySelectorAll('.bk-slot[data-component="fixture-curve"]')]
      .filter((slot) => slot.dataset.state !== 'ready')
      .map((slot) => {
        const rect = slot.getBoundingClientRect()
        const params = JSON.parse(slot.dataset.params)
        return { fn: params.fn, declared: slot.style.getPropertyValue('--slot-h'), width: Math.round(rect.width), height: Math.round(rect.height) }
      }),
  )
  const expectedPlaceholder = (slot) => (slot.declared === '220px' ? 220 : slot.fn === 'tanh' ? 240 : Math.round(slot.width / 2))
  check(
    'at 375 a component placeholder uses the narrow height, and a Markdown height still wins',
    placeholders.length >= 3 && placeholders.every((slot) => Math.abs(slot.height - expectedPlaceholder(slot)) <= 1),
    JSON.stringify(placeholders),
  )
  check('no console errors at 375', phone.errors.length === 0, phone.errors.join(' | '))
  await phone.page.close()
} finally {
  await browser.close()
  server.close()
}

const failed = results.filter((result) => !result.ok).length
console.log(`${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
