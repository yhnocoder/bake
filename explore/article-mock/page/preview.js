const desktop = matchMedia('(hover: hover) and (pointer: fine) and (min-width: 1000px)')
const showDelay = 300
const hideDelay = 200
const warmWindow = 600

function triggerOf(target) {
  if (!(target instanceof Element) || target.closest('.bk-pv')) return null
  return target.closest('a[data-preview], a.bk-eqref[data-eq], .bk-cite a[data-ref]')
}

function contentFor(trigger) {
  const box = document.createElement('div')
  if (trigger.dataset.preview) {
    const template = [...document.querySelectorAll('#bk-previews template')].find((item) => item.dataset.preview === trigger.dataset.preview)
    if (!template) return null
    box.className = 'bk-pv-link'
    box.append(template.content.cloneNode(true))
    return box
  }
  if (trigger.dataset.eq) {
    const equation = document.getElementById(trigger.dataset.eq)
    const block = equation?.closest('.bk-block') ?? equation
    const formula = block?.querySelector('mjx-container')
    if (!formula) return null
    box.className = 'bk-pv-eq'
    box.append(formula.cloneNode(true))
    return box
  }
  const item = document.getElementById(`ref-${trigger.dataset.ref}`)
  if (!item) return null
  box.className = 'bk-pv-ref'
  box.append(item.querySelector('.bk-refs-num').cloneNode(true), item.querySelector('.bk-refs-text').cloneNode(true))
  return box
}

export function startPreviews() {
  const card = document.createElement('div')
  card.className = 'bk-ui bk-pv'
  card.hidden = true
  document.body.append(card)
  let showTimer
  let hideTimer
  let warmUntil = 0
  let current = null

  const place = (trigger) => {
    const rect = [...trigger.getClientRects()].at(0) ?? trigger.getBoundingClientRect()
    const width = card.offsetWidth
    const height = card.offsetHeight
    const left = Math.max(12, Math.min(rect.left, innerWidth - width - 12))
    const below = rect.bottom + 8
    const top = below + height > innerHeight - 12 && rect.top - height - 8 > 12 ? rect.top - height - 8 : below
    card.style.left = `${left}px`
    card.style.top = `${top}px`
  }

  const show = (trigger) => {
    clearTimeout(hideTimer)
    const content = contentFor(trigger)
    if (!content) return
    current = trigger
    card.replaceChildren(content)
    card.dataset.kind = content.className
    card.hidden = false
    place(trigger)
    requestAnimationFrame(() => card.classList.add('is-on'))
  }

  const hide = (now = false) => {
    clearTimeout(showTimer)
    clearTimeout(hideTimer)
    const go = () => {
      if (card.classList.contains('is-on')) warmUntil = performance.now() + warmWindow
      card.classList.remove('is-on')
      current = null
      hideTimer = setTimeout(() => {
        if (!card.classList.contains('is-on')) card.hidden = true
      }, 120)
    }
    if (now) go()
    else hideTimer = setTimeout(go, hideDelay)
  }

  document.addEventListener('pointerover', (event) => {
    if (!desktop.matches) return
    if (event.target instanceof Element && event.target.closest('.bk-pv')) {
      clearTimeout(hideTimer)
      return
    }
    const trigger = triggerOf(event.target)
    if (!trigger || trigger === current) {
      if (trigger) clearTimeout(hideTimer)
      return
    }
    clearTimeout(showTimer)
    if (card.classList.contains('is-on') || performance.now() < warmUntil) show(trigger)
    else showTimer = setTimeout(() => show(trigger), showDelay)
  })

  document.addEventListener('pointerout', (event) => {
    if (!desktop.matches) return
    const from = event.target instanceof Element ? (event.target.closest('.bk-pv') ?? triggerOf(event.target)) : null
    if (!from) return
    const to = event.relatedTarget instanceof Element ? (event.relatedTarget.closest('.bk-pv') ?? triggerOf(event.relatedTarget)) : null
    if (to === from || (to && from.contains(to))) return
    if (!to) hide()
  })

  card.addEventListener('click', (event) => {
    if (event.target.closest('a')) return
    if (current?.dataset.preview) location.href = current.href
  })
  addEventListener('scroll', () => hide(true), { passive: true })
}
