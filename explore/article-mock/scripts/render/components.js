import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import solid from 'vite-plugin-solid'

const reservedNames = new Set(['width', 'height'])
const widths = new Set(['body', 'wide', 'page'])

export async function createComponentLoader(root, directory) {
  globalThis.HTMLElement ??= class {}
  const server = await createServer({
    root,
    configFile: false,
    plugins: [solid({ ssr: true })],
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
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
        file ? server.ssrLoadModule(file).then((module) => ({ file, params: module.params ?? {}, layout: module.layout ?? {} })) : Promise.resolve(null),
      )
    }
    return modules.get(name)
  }

  return { load, close: () => server.close() }
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

export function resolveComponent(component, attributes, fail) {
  const params = {}
  for (const [name, spec] of Object.entries(component.params)) {
    if (reservedNames.has(name)) fail(`the component declares the reserved parameter name ${name}`)
    params[name] = spec.default
  }
  let width = component.layout.width ?? 'body'
  let height = component.layout.height
  for (const [name, raw] of Object.entries(attributes ?? {})) {
    if (name === 'width') {
      if (widths.has(raw)) width = raw
      else fail(`width must be body, wide or page, got "${raw}"`)
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
  const style = typeof height === 'number' ? `--slot-h:${height}px` : height?.ratio ? `--slot-ratio:${height.ratio}` : '--slot-h:320px'
  return { params, width, style, frame: component.layout.frame !== false }
}
