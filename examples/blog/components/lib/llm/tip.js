import { onCleanup, onMount } from 'solid-js'

export const tipTransform = (left, top, flip) => `translate(${left}px, ${top}px)` + (flip ? ' translateX(-100%)' : '')

export function createPointerFrames(apply) {
  let frame = 0
  let latest = null
  const cancel = () => {
    cancelAnimationFrame(frame)
    frame = 0
    latest = null
  }
  const run = () => {
    frame = 0
    const event = latest
    latest = null
    if (event !== null) apply(event)
  }
  const track = (event) => {
    latest = { clientX: event.clientX, clientY: event.clientY, target: event.target }
    if (frame === 0) frame = requestAnimationFrame(run)
  }
  onCleanup(cancel)
  return { track, cancel }
}

export function hideOnScroll(shown, hide) {
  const onScroll = () => {
    if (shown()) hide()
  }
  onMount(() => {
    addEventListener('scroll', onScroll, { passive: true })
    onCleanup(() => removeEventListener('scroll', onScroll))
  })
}
