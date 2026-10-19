const tocOptions = [
  ['notes', 'T1 前文笔记'],
  ['tabs', 'T2 书签索引'],
  ['dots', 'T3 圆点胶囊'],
  ['ticks', 'T4 刻度线'],
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
  toggle.textContent = '样式'
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
    segment('主题', themeOptions, root.dataset.theme ?? 'system', (value) => {
      if (value === 'system') delete root.dataset.theme
      else root.dataset.theme = value
      store('bk-theme', value === 'system' ? null : value)
    }),
  )
  panel.append(toggle, body)
  document.body.append(panel)
}
