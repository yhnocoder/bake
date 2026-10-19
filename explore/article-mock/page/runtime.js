import { createComponent, render } from 'solid-js/web'
import { createStore, reconcile } from 'solid-js/store'

const modules = import.meta.glob('@components/*.{js,jsx}')
const moduleByName = new Map(
  Object.entries(modules).map(([path, load]) => [
    path
      .split('/')
      .pop()
      .replace(/\.jsx?$/, ''),
    load,
  ]),
)
const ready = new Map()

function wrapSolid(Component) {
  return class extends HTMLElement {
    connectedCallback() {
      const [props, setProps] = createStore({ ...this.params })
      this.setProps = setProps
      this.dispose = render(() => createComponent(Component, props), this)
    }
    disconnectedCallback() {
      this.dispose?.()
    }
    update() {
      this.setProps(reconcile({ ...this.params }))
    }
  }
}

function define(name) {
  if (!ready.has(name)) {
    const load = moduleByName.get(name)
    if (!load) throw new Error(`Unknown component <${name}>`)
    ready.set(
      name,
      load().then((module) => {
        const Component = module.default
        const isElement = Component.prototype instanceof HTMLElement
        customElements.define(name, isElement ? Component : wrapSolid(Component))
      }),
    )
  }
  return ready.get(name)
}

async function mount(slot) {
  if (slot.dataset.state) return
  slot.dataset.state = 'loading'
  const name = slot.dataset.component
  await define(name)
  const element = document.createElement(name)
  element.params = JSON.parse(slot.dataset.params || '{}')
  slot.append(element)
  slot.dataset.state = 'ready'
}

function watchTheme() {
  const notify = () => document.dispatchEvent(new CustomEvent('bake:theme'))
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', notify)
  new MutationObserver(notify).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
}

export function startComponents(root = document) {
  const slots = [...root.querySelectorAll('.bk-slot[data-component]')]
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        observer.unobserve(entry.target)
        mount(entry.target)
      }
    },
    { rootMargin: '800px 0px' },
  )
  for (const slot of slots) observer.observe(slot)
  addEventListener('beforeprint', () => slots.forEach(mount))
  watchTheme()
}
