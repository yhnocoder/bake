import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createServer } from 'vite'
import solid from 'vite-plugin-solid'

const reservedNames = new Set(['width', 'height'])
const widths = new Set(['body', 'wide', 'page'])
const sizePattern = /^(\d+(?:\.\d+)?)(px|%)$/

function readWidth(value) {
  if (widths.has(value)) return { width: value }
  const match = sizePattern.exec(String(value))
  if (!match || Number(match[1]) <= 0 || (match[2] === '%' && Number(match[1]) > 100)) return null
  return { width: 'body', size: value }
}

export async function createComponentLoader(root, directory) {
  globalThis.HTMLElement ??= class {}
  const server = await createServer({
    root,
    configFile: false,
    plugins: [solid({ ssr: true })],
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'silent',
  })
  const modules = new Map()

  function fileOf(name) {
    for (const extension of ['.jsx', '.js']) {
      const file = join(directory, name + extension)
      if (existsSync(file)) return file
    }
    return null
  }

  async function load(name) {
    if (!modules.has(name)) {
      const file = fileOf(name)
      modules.set(
        name,
        file
          ? server.ssrLoadModule(file).then(
              (module) => ({ file, params: module.params ?? {}, layout: module.layout ?? {} }),
              (error) => ({ file, error: moduleError(name, file, error) }),
            )
          : Promise.resolve(null),
      )
    }
    return modules.get(name)
  }

  return { load, close: () => server.close() }
}

const browserGlobals = /^(window|document|navigator|location|localStorage|sessionStorage|customElements|requestAnimationFrame|matchMedia|getComputedStyle|ResizeObserver|IntersectionObserver|HTMLCanvasElement|Image)$/

function moduleError(name, file, error) {
  const global = error instanceof ReferenceError && error.message.match(/^(\w+) is not defined/)?.[1]
  const where = `components/${basename(file)}`
  if (global && browserGlobals.test(global)) {
    return `${name}: ${where} uses the browser API ${global} at the top level; the build reads params and layout in Node, so use it inside the component code`
  }
  return `${name}: ${where} failed to load: ${error.message}`
}

function convert(name, spec, raw) {
  if (spec.type === 'number') {
    const value = Number(raw)
    if (raw === '' || !Number.isFinite(value)) return { error: `${name} must be a number, got "${raw}"` }
    if (spec.min !== undefined && value < spec.min) return { error: `${name}=${raw} is below the minimum ${spec.min}` }
    if (spec.max !== undefined && value > spec.max) return { error: `${name}=${raw} is above the maximum ${spec.max}` }
    return { value }
  }
  if (spec.type === 'boolean') {
    if (raw === '' || raw === 'true') return { value: true }
    if (raw === 'false') return { value: false }
    return { error: `${name} must be true or false, got "${raw}"` }
  }
  if (spec.type === 'enum') {
    if (!spec.options.includes(raw)) return { error: `${name} must be one of ${spec.options.join(', ')}, got "${raw}"` }
    return { value: raw }
  }
  if (spec.type === 'text') return { value: raw }
  return { error: `${name} has an unknown parameter type ${spec.type}` }
}

function valueFor(declared, params) {
  return typeof declared === 'function' ? declared(params) : declared
}

function sizeStyle(size, heightName, ratioName) {
  if (typeof size === 'number') return `${heightName}:${size}px`
  if (size?.ratio) return `${ratioName}:${size.ratio};${heightName}:auto`
  return null
}

export function resolveComponent(component, attributes, fail) {
  const params = {}
  for (const [name, spec] of Object.entries(component.params)) {
    if (reservedNames.has(name)) fail(`the component declares the reserved parameter name ${name}`)
    params[name] = spec.default
  }
  let width = readWidth(component.layout.width ?? 'body')
  if (!width) {
    fail(`layout.width must be body, wide, page, pixels or a percentage up to 100%, got "${component.layout.width}"`)
    width = { width: 'body' }
  }
  let height = null
  for (const [name, raw] of Object.entries(attributes ?? {})) {
    if (name === 'width') {
      const value = readWidth(raw)
      if (value) width = value
      else fail(`width must be body, wide, page, pixels such as 560px, or a percentage up to 100% such as 70%; got "${raw}"`)
      continue
    }
    if (name === 'height') {
      const value = Number(raw)
      if (Number.isFinite(value) && value > 0) height = value
      else fail(`height must be a positive number of pixels, got "${raw}"`)
      continue
    }
    const spec = component.params[name]
    if (!spec) {
      fail(`unknown parameter ${name}; declared parameters: ${Object.keys(component.params).join(', ') || 'none'}`)
      continue
    }
    const result = convert(name, spec, raw)
    if (result.error) fail(result.error)
    else params[name] = result.value
  }
  const narrow = height === null ? valueFor(component.layout.narrowHeight, params) : null
  if (height === null) height = valueFor(component.layout.height, params)
  const style = [sizeStyle(height, '--slot-h', '--slot-ratio') ?? '--slot-h:320px', sizeStyle(narrow, '--slot-nh', '--slot-nratio')].filter(Boolean).join(';')
  return { params, width: width.width, size: width.size, style, frame: component.layout.frame !== false }
}
