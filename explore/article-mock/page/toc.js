import { jumpTo, onFrame } from './blocks.js'

const wideScreen = matchMedia('(min-width: 1340px)')
const narrowScreen = matchMedia('(max-width: 999.98px)')
const styleNames = { notes: '前文笔记', tabs: '书签索引', dots: '圆点胶囊', ticks: '刻度线' }

function element(tag, className, html) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (html !== undefined) node.innerHTML = html
  return node
}

function plain(html) {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent
}

function readData() {
  const script = document.getElementById('bk-toc-data')
  return script ? JSON.parse(script.textContent) : []
}

function buildEntries(chapters) {
  const entries = []
  chapters.forEach((chapter, chapterIndex) => {
    entries.push({ id: chapter.id, level: 2, chapterIndex, sectionIndex: -1 })
    chapter.sections.forEach((section, sectionIndex) => entries.push({ id: section.id, level: 3, chapterIndex, sectionIndex }))
  })
  for (const entry of entries) entry.element = document.getElementById(entry.id)
  return entries.filter((entry) => entry.element)
}

function readingState(entries) {
  const line = Math.min(innerHeight * 0.3, 240)
  let current = -1
  for (let index = 0; index < entries.length; index++) {
    if (entries[index].element.getBoundingClientRect().top <= line) current = index
    else break
  }
  const entry = entries[current]
  let progress = 0
  if (entry) {
    const top = entry.element.getBoundingClientRect().top
    const next = entries[current + 1]?.element.getBoundingClientRect().top ?? document.querySelector('.bk-article').getBoundingClientRect().bottom
    progress = Math.min(1, Math.max(0, (line - top) / Math.max(1, next - top)))
  }
  return {
    index: current,
    chapter: entry ? entry.chapterIndex : -1,
    section: entry ? entry.sectionIndex : -1,
    progress,
  }
}

function go(id) {
  jumpTo(document.getElementById(id))
}

function linkTo(id, className, html) {
  const link = element('a', className, html)
  link.href = `#${id}`
  link.addEventListener('click', (event) => {
    event.preventDefault()
    go(id)
    document.dispatchEvent(new CustomEvent('bk:toc-jump'))
  })
  return link
}

function sectionNumber(chapter, index) {
  return `${Number(chapter.number)}.${index + 1}`
}

function createCard() {
  const card = element('div', 'bk-ui bk-toc-card')
  card.hidden = true
  document.body.append(card)
  let hideTimer
  const api = {
    card,
    show(content, anchor, { side = 'right' } = {}) {
      clearTimeout(hideTimer)
      card.replaceChildren(content)
      card.hidden = false
      const rect = anchor.getBoundingClientRect()
      const width = card.offsetWidth
      const height = card.offsetHeight
      const left = side === 'right' ? rect.right + 12 : rect.left
      card.style.left = `${Math.min(left, innerWidth - width - 12)}px`
      card.style.top = `${Math.max(12, Math.min(rect.top - 10, innerHeight - height - 12))}px`
      requestAnimationFrame(() => card.classList.add('is-on'))
    },
    hide(delay = 200) {
      clearTimeout(hideTimer)
      hideTimer = setTimeout(() => {
        card.classList.remove('is-on')
        hideTimer = setTimeout(() => {
          card.hidden = true
        }, 120)
      }, delay)
    },
    keep() {
      clearTimeout(hideTimer)
    },
  }
  card.addEventListener('pointerenter', api.keep)
  card.addEventListener('pointerleave', () => api.hide())
  return api
}

function chapterCard(chapter) {
  const box = element('div', 'bk-tc')
  box.append(linkTo(chapter.id, 'bk-tc-title', `${chapter.number} ${chapter.fullTitle}`))
  if (chapter.lead) box.append(element('div', 'bk-tc-lead', chapter.lead))
  if (chapter.sections.length) {
    const list = element('div', 'bk-tc-sections')
    chapter.sections.forEach((section, index) => list.append(linkTo(section.id, 'bk-tc-section', `${sectionNumber(chapter, index)} ${section.title}`)))
    box.append(list)
  }
  return box
}

function entryCard(chapters, entry) {
  const chapter = chapters[entry.chapterIndex]
  if (entry.level === 2) {
    const box = element('div', 'bk-tc')
    box.append(linkTo(chapter.id, 'bk-tc-title', `${chapter.number} ${chapter.fullTitle}`))
    if (chapter.lead) box.append(element('div', 'bk-tc-lead', chapter.lead))
    return box
  }
  const section = chapter.sections[entry.sectionIndex]
  const box = element('div', 'bk-tc')
  box.append(linkTo(section.id, 'bk-tc-title', `${sectionNumber(chapter, entry.sectionIndex)} ${section.title}`))
  if (section.lead) box.append(element('div', 'bk-tc-lead', section.lead))
  return box
}

function notesView(chapters) {
  const root = element('div', 'bk-tn')
  root.append(element('div', 'bk-toc-label', '前文笔记'))
  const list = element('div', 'bk-tn-list')
  root.append(list)
  const parts = chapters.map((chapter) => {
    const part = linkTo(chapter.id, 'bk-tn-part', `${chapter.number} ${chapter.title}`)
    const fold = element('div', 'bk-tn-fold')
    const inner = element('div', 'bk-tn-fold-inner')
    fold.append(inner)
    const items = chapter.sections.map((section) => {
      const item = element('div', 'bk-tn-it')
      item.append(linkTo(section.id, 'bk-tn-link', section.title))
      const progress = element('span', 'bk-tn-prog')
      item.append(progress)
      if (section.recap) {
        const note = element('div', 'bk-tn-note')
        note.append(element('div', 'bk-tn-note-inner', section.recap))
        item.append(note)
      }
      inner.append(item)
      return { item, progress }
    })
    list.append(part, fold)
    return { part, fold, items }
  })
  let lastIndex = null
  let revealTimer
  return {
    root,
    update(state) {
      parts.forEach(({ part, fold, items }, chapterIndex) => {
        const relation = chapterIndex < state.chapter ? 'read' : chapterIndex === state.chapter ? 'cur' : 'ahead'
        part.dataset.state = relation
        part.toggleAttribute('data-here', relation === 'cur' && state.section === -1)
        fold.classList.toggle('is-open', relation !== 'ahead')
        items.forEach(({ item, progress }, sectionIndex) => {
          let itemState = 'ahead'
          if (relation === 'read' || (relation === 'cur' && sectionIndex < state.section)) itemState = 'read'
          else if (relation === 'cur' && sectionIndex === state.section) itemState = 'cur'
          item.dataset.state = itemState
          progress.style.height = itemState === 'cur' ? `${Math.round(state.progress * 100)}%` : '0'
        })
      })
      if (state.index !== lastIndex) {
        lastIndex = state.index
        clearTimeout(revealTimer)
        revealTimer = setTimeout(reveal, 340)
      }
    },
  }

  function reveal() {
    const current = root.querySelector('[data-state="cur"].bk-tn-it') ?? root.querySelector('.bk-tn-part[data-state="cur"]')
    const scroller = root.closest('.bk-toc-scroll')
    if (current && scroller) {
      const box = scroller.getBoundingClientRect()
      const rect = current.getBoundingClientRect()
      if (rect.top < box.top + 40 || rect.bottom > box.bottom - 40) scroller.scrollBy({ top: rect.top - box.top - box.height / 3, behavior: 'smooth' })
    }
  }
}

function tabsView(chapters, card) {
  const root = element('div', 'bk-tt')
  const tabs = chapters.map((chapter) => {
    const tab = element('button', 'bk-tt-tab', chapter.number)
    tab.type = 'button'
    tab.setAttribute('aria-label', plain(`${chapter.number} ${chapter.title}`))
    tab.addEventListener('click', () => go(chapter.id))
    tab.addEventListener('pointerenter', () => card.show(chapterCard(chapter), tab))
    tab.addEventListener('pointerleave', () => card.hide())
    root.append(tab)
    return tab
  })
  const title = element('div', 'bk-tt-title')
  root.append(title)
  let shown = null
  return {
    root,
    update(state) {
      const current = Math.max(0, state.chapter)
      if (shown !== current) {
        shown = current
        title.innerHTML = chapters[current]?.title ?? ''
        title.title = plain(chapters[current]?.title ?? '')
      }
      let top = 40
      tabs.forEach((tab, index) => {
        tab.classList.toggle('is-cur', index === current)
        tab.classList.toggle('is-read', index < current)
        if (index === current) top += 6
        tab.style.translate = `0 ${top}px`
        if (index === current) {
          title.style.translate = `0 ${top + 44}px`
          top += 44 + title.offsetHeight + 22
        } else top += 36
      })
    },
  }
}

function dotsView(chapters, card) {
  const root = element('div', 'bk-td')
  const column = element('div', 'bk-td-col')
  root.append(column)
  const items = chapters.map((chapter) => {
    const item = element('div', 'bk-td-it')
    const dot = element('button', 'bk-td-dot')
    dot.type = 'button'
    dot.setAttribute('aria-label', plain(`${chapter.number} ${chapter.title}`))
    dot.append(element('span', 'bk-td-num', chapter.number), element('span', 'bk-td-vt', chapter.title))
    dot.addEventListener('click', () => go(chapter.id))
    dot.addEventListener('pointerenter', () => card.show(chapterCard(chapter), dot))
    dot.addEventListener('pointerleave', () => card.hide())
    item.append(dot)
    column.append(item)
    return { item, dot }
  })
  let shown = null
  return {
    root,
    update(state) {
      const current = Math.max(0, state.chapter)
      items.forEach(({ dot }, index) => {
        dot.classList.toggle('is-read', index < current)
        if (index === current && !dot.classList.contains('is-cur')) {
          dot.classList.add('is-cur')
          const text = dot.querySelector('.bk-td-vt')
          dot.style.height = `${Math.min(260, text.scrollHeight) + 40}px`
        } else if (index !== current && dot.classList.contains('is-cur')) {
          dot.classList.remove('is-cur')
          dot.style.height = ''
        }
      })
      if (shown !== current) {
        shown = current
        requestAnimationFrame(() => {
          const viewport = root.clientHeight
          const total = column.scrollHeight
          const overflow = total > viewport - 80
          root.classList.toggle('is-overflowing', overflow)
          if (!overflow) {
            column.style.translate = '0 40px'
            return
          }
          const item = items[current].item
          const center = item.offsetTop + 120
          const shift = Math.max(viewport - total - 40, Math.min(40, viewport / 2 - center))
          column.style.translate = `0 ${shift}px`
        })
      }
    },
  }
}

function ticksView(chapters, entries, card) {
  const root = element('div', 'bk-tk')
  const column = element('div', 'bk-tk-col')
  root.append(column)
  const ticks = entries.map((entry) => {
    const tick = element('a', `bk-tk-it bk-tk-h${entry.level}`)
    tick.href = `#${entry.id}`
    tick.append(element('span', 'bk-tk-line'))
    tick.addEventListener('click', (event) => {
      event.preventDefault()
      go(entry.id)
    })
    tick.addEventListener('pointerenter', () => {
      if (!root.classList.contains('is-expanded')) card.show(entryCard(chapters, entry), column)
      card.card.style.top = `${Math.max(12, tick.getBoundingClientRect().top - 20)}px`
    })
    column.append(tick)
    return tick
  })
  const list = element('div', 'bk-tk-list')
  root.append(list)
  const rows = []
  chapters.forEach((chapter, chapterIndex) => {
    const row = linkTo(chapter.id, 'bk-tk-row', `${chapter.number} ${chapter.title}`)
    row.dataset.chapter = chapterIndex
    list.append(row)
    rows.push({ row, chapterIndex, sectionIndex: -1 })
    chapter.sections.forEach((section, sectionIndex) => {
      const sub = linkTo(section.id, 'bk-tk-row bk-tk-sub', section.title)
      list.append(sub)
      rows.push({ row: sub, chapterIndex, sectionIndex })
    })
  })
  let dwell
  root.addEventListener('pointerenter', () => {
    clearTimeout(dwell)
    dwell = setTimeout(() => {
      card.hide(0)
      root.classList.add('is-expanded')
    }, 500)
  })
  root.addEventListener('pointerleave', () => {
    clearTimeout(dwell)
    root.classList.remove('is-expanded')
    card.hide()
  })
  return {
    root,
    update(state) {
      ticks.forEach((tick, index) => {
        tick.classList.toggle('is-cur', index === state.index)
        tick.classList.toggle('is-read', index < state.index)
      })
      rows.forEach(({ row, chapterIndex, sectionIndex }) => {
        const isCurrent = chapterIndex === state.chapter && sectionIndex === (sectionIndex === -1 ? -1 : state.section)
        row.classList.toggle('is-cur', chapterIndex === state.chapter && (sectionIndex === -1 || sectionIndex === state.section))
        row.classList.toggle('is-ahead', chapterIndex > state.chapter || (chapterIndex === state.chapter && sectionIndex > state.section))
        row.hidden = sectionIndex !== -1 && chapterIndex !== Math.max(0, state.chapter)
        row.toggleAttribute('aria-current', isCurrent)
      })
    },
  }
}

function drawerList(chapters, withNotes) {
  if (withNotes) return notesView(chapters)
  const root = element('div', 'bk-dl')
  root.append(element('div', 'bk-toc-label', '目录'))
  const rows = []
  chapters.forEach((chapter, chapterIndex) => {
    const row = linkTo(chapter.id, 'bk-dl-row', `<span class="bk-dl-num">${chapter.number}</span>${chapter.title}`)
    root.append(row)
    rows.push({ row, chapterIndex, sectionIndex: -1 })
    chapter.sections.forEach((section, sectionIndex) => {
      const sub = linkTo(section.id, 'bk-dl-row bk-dl-sub', section.title)
      root.append(sub)
      rows.push({ row: sub, chapterIndex, sectionIndex })
    })
  })
  return {
    root,
    update(state) {
      for (const { row, chapterIndex, sectionIndex } of rows) {
        row.classList.toggle('is-cur', chapterIndex === state.chapter && (sectionIndex === -1 ? state.section === -1 : sectionIndex === state.section))
        row.classList.toggle('is-read', chapterIndex < state.chapter || (chapterIndex === state.chapter && sectionIndex !== -1 && sectionIndex < state.section))
      }
    },
  }
}

function createDrawer(chapters) {
  const button = element('button', 'bk-ui bk-toc-button')
  button.type = 'button'
  button.setAttribute('aria-expanded', 'false')
  const scrim = element('div', 'bk-ui bk-drawer-scrim')
  const drawer = element('div', 'bk-ui bk-drawer')
  drawer.setAttribute('role', 'dialog')
  drawer.setAttribute('aria-label', '目录')
  const scroller = element('div', 'bk-toc-scroll bk-drawer-scroll')
  drawer.append(scroller)
  document.body.append(scrim, drawer, button)
  let view = null
  const setOpen = (open) => {
    document.documentElement.classList.toggle('bk-drawer-open', open)
    button.setAttribute('aria-expanded', String(open))
  }
  button.addEventListener('click', () => setOpen(!document.documentElement.classList.contains('bk-drawer-open')))
  scrim.addEventListener('click', () => setOpen(false))
  addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setOpen(false)
  })
  document.addEventListener('bk:toc-jump', () => setOpen(false))
  return {
    setStyle(style) {
      view = drawerList(chapters, style === 'notes')
      scroller.replaceChildren(view.root)
      button.dataset.style = style
    },
    update(state) {
      view?.update(state)
      if (button.dataset.style === 'notes') button.innerHTML = '<span aria-hidden="true">☰</span> 前文笔记'
      else button.textContent = chapters[Math.max(0, state.chapter)]?.number ?? '☰'
    },
  }
}

function watchPageBlocks(nav) {
  const visible = new Set()
  const observer = new IntersectionObserver((records) => {
    for (const record of records) {
      if (record.isIntersecting) visible.add(record.target)
      else visible.delete(record.target)
    }
    nav.classList.toggle('is-yielding', visible.size > 0 && wideScreen.matches)
  })
  for (const block of document.querySelectorAll('.bk-article [data-width="page"]')) observer.observe(block)
}

export function currentTocStyle() {
  return document.documentElement.dataset.toc ?? 'notes'
}

export function startToc() {
  const nav = document.querySelector('.bk-toc')
  const article = document.querySelector('.bk-article')
  if (!nav || !article) return
  const chapters = readData()
  const entries = buildEntries(chapters)
  const card = createCard()
  const sticky = element('div', 'bk-toc-sticky')
  const scroller = element('div', 'bk-toc-scroll')
  sticky.append(scroller)
  nav.append(sticky)
  const drawer = createDrawer(chapters)
  let view = null
  let effective = null

  const positionNav = () => {
    nav.style.top = `${article.offsetTop}px`
  }

  const update = onFrame(() => {
    const state = readingState(entries)
    view?.update(state)
    drawer.update(state)
  })

  const render = () => {
    const style = currentTocStyle()
    const next = style === 'notes' && !wideScreen.matches ? 'ticks' : style
    nav.dataset.view = next
    drawer.setStyle(style)
    if (next !== effective) {
      effective = next
      card.hide(0)
      if (next === 'notes') view = notesView(chapters)
      else if (next === 'tabs') view = tabsView(chapters, card)
      else if (next === 'dots') view = dotsView(chapters, card)
      else view = ticksView(chapters, entries, card)
      scroller.replaceChildren(view.root)
      nav.setAttribute('aria-label', `目录：${styleNames[next]}`)
    }
    positionNav()
    update()
  }

  render()
  addEventListener('scroll', update, { passive: true })
  addEventListener('resize', () => {
    positionNav()
    update()
  })
  wideScreen.addEventListener('change', render)
  narrowScreen.addEventListener('change', render)
  document.addEventListener('bk:toc-style', render)
  document.addEventListener('bk:layout', update)
  watchPageBlocks(nav)
}
