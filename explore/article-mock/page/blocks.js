const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)')

export function onFrame(callback) {
  let pending = false
  return () => {
    if (pending) return
    pending = true
    requestAnimationFrame(() => {
      pending = false
      callback()
    })
  }
}

function updateFades(block) {
  const scroller = block.querySelector(':scope > .bk-scroll')
  const left = scroller.scrollLeft > 2
  const right = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 2
  block.toggleAttribute('data-fade-left', left)
  block.toggleAttribute('data-fade-right', right)
}

function resolveWidths(blocks) {
  for (const block of blocks) {
    if (block.dataset.width !== 'auto') continue
    delete block.dataset.resolved
  }
  const overflowing = blocks.filter((block) => {
    if (block.dataset.width !== 'auto') return false
    const scroller = block.querySelector(':scope > .bk-scroll')
    return scroller.scrollWidth > scroller.clientWidth + 1
  })
  for (const block of overflowing) block.dataset.resolved = 'wide'
  for (const block of blocks) updateFades(block)
  document.dispatchEvent(new CustomEvent('bk:layout'))
}

export function startBlocks(article) {
  const blocks = [...article.querySelectorAll('.bk-block')]
  const resolve = onFrame(() => resolveWidths(blocks))
  resolve()
  new ResizeObserver(resolve).observe(article)
  document.fonts?.ready.then(resolve)
  for (const block of blocks) {
    const scroller = block.querySelector(':scope > .bk-scroll')
    scroller.addEventListener(
      'scroll',
      onFrame(() => updateFades(block)),
      { passive: true },
    )
  }
  for (const image of article.querySelectorAll('.bk-image img')) {
    if (image.complete) image.classList.add('bk-loaded')
    else image.addEventListener('load', () => image.classList.add('bk-loaded'), { once: true })
    image.addEventListener('error', () => image.classList.add('bk-loaded'), { once: true })
  }
}

function animateFold(details) {
  const body = details.querySelector('.bk-fold-body')
  if (reduceMotion.matches) {
    details.open = !details.open
    return
  }
  body.getAnimations().forEach((animation) => animation.cancel())
  const timing = { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' }
  if (!details.open) {
    details.open = true
    const height = body.offsetHeight
    body.animate(
      [
        { height: '0px', opacity: 0, marginTop: '0px' },
        { height: `${height}px`, opacity: 1, marginTop: '8px' },
      ],
      timing,
    ).onfinish = () => document.dispatchEvent(new CustomEvent('bk:layout'))
  } else {
    const height = body.offsetHeight
    const animation = body.animate(
      [
        { height: `${height}px`, opacity: 1, marginTop: '8px' },
        { height: '0px', opacity: 0, marginTop: '0px' },
      ],
      { ...timing, duration: 180 },
    )
    animation.onfinish = () => {
      details.open = false
      document.dispatchEvent(new CustomEvent('bk:layout'))
    }
  }
}

export function startFolds(root) {
  for (const details of root.querySelectorAll('.bk-fold')) {
    const summary = details.querySelector(':scope > summary')
    summary.addEventListener('click', (event) => {
      event.preventDefault()
      animateFold(details)
    })
  }
  addEventListener('beforeprint', () => {
    for (const details of root.querySelectorAll('.bk-fold')) {
      details.dataset.printOpened = details.open ? '' : 'yes'
      details.open = true
    }
  })
  addEventListener('afterprint', () => {
    for (const details of root.querySelectorAll('.bk-fold')) {
      if (details.dataset.printOpened === 'yes') details.open = false
      delete details.dataset.printOpened
    }
  })
}

let toastTimer
export function toast(text) {
  let element = document.querySelector('.bk-toast')
  if (!element) {
    element = document.createElement('div')
    element.className = 'bk-toast'
    element.setAttribute('role', 'status')
    document.body.append(element)
  }
  element.textContent = text
  element.classList.add('is-on')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => element.classList.remove('is-on'), 1400)
}

export function jumpTo(target, { updateHash = true } = {}) {
  if (!target) return
  for (const details of [...document.querySelectorAll('.bk-fold:not([open])')]) {
    if (details.contains(target)) details.open = true
  }
  const top = target.getBoundingClientRect().top + scrollY - 24
  scrollTo({ top, behavior: reduceMotion.matches ? 'auto' : 'smooth' })
  if (updateHash && target.id) history.replaceState(null, '', `#${target.id}`)
  const flashed = target.matches('h2, h3, h4, p, li, .bk-block, .bk-sn') ? target : (target.closest('.bk-block, p, li') ?? target)
  flashed.classList.add('bk-flash')
  setTimeout(() => flashed.classList.remove('bk-flash'), reduceMotion.matches ? 400 : 900)
}

export function startJumps() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]')
    if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return
    if (link.closest('.bk-ref')) return
    const id = decodeURIComponent(link.getAttribute('href').slice(1))
    const target = id && document.getElementById(id)
    if (!target) return
    event.preventDefault()
    if (link.classList.contains('bk-hash')) {
      const url = `${location.href.split('#')[0]}#${id}`
      navigator.clipboard?.writeText(url).then(
        () => toast('已复制本节链接'),
        () => toast(url),
      )
      history.replaceState(null, '', `#${id}`)
      return
    }
    jumpTo(target)
  })
  if (location.hash) {
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)))
    if (target) requestAnimationFrame(() => jumpTo(target, { updateHash: false }))
  }
}

export function startDragGuard() {
  document.addEventListener('pointerdown', (event) => {
    const control = event.target.closest('input[type="range"], [data-drag]')
    if (!control) return
    document.documentElement.classList.add('bk-dragging')
    const stop = () => {
      document.documentElement.classList.remove('bk-dragging')
      removeEventListener('pointerup', stop)
      removeEventListener('pointercancel', stop)
    }
    addEventListener('pointerup', stop)
    addEventListener('pointercancel', stop)
  })
}
