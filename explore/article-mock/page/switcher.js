const tocOptions = [
  ['notes', 'T1 前文笔记'],
  ['tabs', 'T2 书签索引'],
  ['dots', 'T3 圆点胶囊'],
  ['ticks', 'T4 刻度线'],
]
const fontOptions = [
  ['sans', '黑体'],
  ['wenkai', '霞鹜文楷'],
]
const themeOptions = [
  ['system', '跟随系统'],
  ['light', '浅'],
  ['dark', '深'],
]

function store(key, value) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {}
}

function segment(label, options, selected, onPick) {
  const row = document.createElement('div')
  row.className = 'bk-sw-row'
  const name = document.createElement('span')
  name.className = 'bk-sw-label'
  name.textContent = label
  const group = document.createElement('div')
  group.className = 'bk-sw-seg'
  group.setAttribute('role', 'group')
  group.setAttribute('aria-label', label)
  const buttons = options.map(([value, text]) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = text
    button.dataset.value = value
    button.setAttribute('aria-pressed', String(value === selected))
    button.addEventListener('click', () => {
      for (const other of buttons) other.setAttribute('aria-pressed', String(other === button))
      onPick(value)
    })
    return button
  })
  group.append(...buttons)
  row.append(name, group)
  return row
}

export function startSwitcher() {
  const root = document.documentElement
  const panel = document.createElement('div')
  panel.className = 'bk-ui bk-switcher'
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'bk-sw-toggle'
  toggle.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h7M13 4h1M2 12h1M7 12h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="11" cy="4" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="5" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg><span>设置</span>'
  toggle.setAttribute('aria-expanded', 'false')
  toggle.addEventListener('click', () => {
    const open = !panel.classList.contains('is-open')
    panel.classList.toggle('is-open', open)
    toggle.setAttribute('aria-expanded', String(open))
  })
  const body = document.createElement('div')
  body.className = 'bk-sw-body'
  const hasToc = Boolean(document.querySelector('.bk-toc'))
  if (hasToc) {
    body.append(
      segment('目录', tocOptions, root.dataset.toc ?? 'notes', (value) => {
        root.dataset.toc = value
        store('bk-toc', value)
        document.dispatchEvent(new CustomEvent('bk:toc-style'))
      }),
    )
  }
  body.append(
    segment('正文', fontOptions, root.dataset.font ?? 'sans', (value) => {
      if (value === 'sans') delete root.dataset.font
      else root.dataset.font = value
      store('bk-font', value === 'sans' ? null : value)
      document.dispatchEvent(new CustomEvent('bk:layout'))
    }),
  )
  body.append(
    segment('主题', themeOptions, root.dataset.theme ?? 'system', (value) => {
      if (value === 'system') delete root.dataset.theme
      else root.dataset.theme = value
      store('bk-theme', value === 'system' ? null : value)
    }),
  )
  panel.append(toggle, body)
  document.body.append(panel)
}
